import { z } from "zod";

import { callWithRetry, getModelSnapshot } from "@/server/modules/ai/client";
import { repairTruncatedJson } from "@/server/modules/analysis/pipeline/repair-json";

/**
 * L2：让模型对候选清单做「哪些名字是同一人」的建议。
 *
 * ## 定位：只提建议，不写库、不改图谱
 *
 * 参考项目 AI-Reader-V2 的 `entity_dictionary` 做过同样的事，它自认该步准确率约 45%。
 * 因此这里的三条设计都围绕「错了也不会造成伤害」：
 *
 * 1. **输出只到建议层**：调用方拿到的是待审核列表，不是直接生效的配置；
 * 2. **确定性关卡兜底**：每个别名必须能在给出的片段里字面找到（`sanitizeSuggestions`），
 *    模型编造的别名一律丢弃并留档 —— 与 P2 grounding 同一条思路；
 * 3. **不确定就不合并**：`aliases` 为空是合法且常见的输出。
 *
 * ## 为什么只送片段不送全文
 *
 * 送全文（红楼 2.57 MB ≈ 100 万 token）一次要几块钱，而它判断的只是
 * 「这几个名字指不指同一个人」——看两三句原文就够。片段是**证据**，不是背景阅读材料。
 */

/**
 * 模型输出上限。
 *
 * 实测：177 个候选时输出约 3000 token，但 `rejects` 条数波动很大（55–103 条），
 * 4096 曾被吃满导致 JSON 截断。给到 6144 留余量；真撞上也有 `repairTruncatedJson` 兜底。
 */
const MAX_TOKENS = 6144;

/** 温度固定 0：这一步是分类判断，不需要创造性。 */
const TEMPERATURE = 0;

/**
 * 不能作为别名结尾的字（动词、助词、语气词）。
 *
 * 来源是实测：模型给出的错误别名绝大多数是「名字 + 动作」的截断
 * （`李贵忙`、`雨村道`、`黛玉笑`）。用形态规则挡比用「必须在候选里」挡更准 ——
 * 后者会误伤 `甄士隐` 这类因分词切碎而没进候选的全名。
 */
export const TRAILING_FUNCTION_CHARS = /[道忙笑说便又也都来去着了过得的地吗呢吧啊哦呀]/u;

/** 单次送入的候选上限（控制提示词体积；按频次降序取前 N）。 */
export const MAX_CANDIDATES_PER_CALL = 200;

/** 每个候选随附的片段条数。 */
export const SAMPLES_PER_CANDIDATE = 2;

/** 送给模型的候选（含证据片段）。 */
export interface SuggestCandidate {
  name        : string;
  frequency   : number;
  firstChapter: number;
  samples     : string[];
}

/** 模型输出的 schema（多余字段一律拒绝，防止它「顺手」加字段）。 */
const RawSuggestionSchema = z.object({
  persons: z
    .array(
      z.object({
        name   : z.string(),
        aliases: z.array(z.string()).default([]),
        reason : z.string().default("")
      })
    )
    .default([]),
  rejects: z
    .array(
      z.object({
        name  : z.string(),
        reason: z.string().default("")
      })
    )
    .default([])
});

export type RawSuggestion = z.infer<typeof RawSuggestionSchema>;

/** 清洗后的建议（可直接给页面）。 */
export interface SanitizedSuggestion {
  persons      : { name: string; aliases: string[]; reason: string }[];
  rejects      : { name: string; reason: string }[];
  /** 被确定性关卡砍掉的别名（模型编造或不在证据里）。 */
  droppedAliases: { name: string; alias: string; reason: string }[];
}

/**
 * 确定性关卡：把模型输出收敛到「能被证据支持」的范围内。
 *
 * 三道过滤，全部可单测：
 * 1. `name` 必须是我们送进去的候选（模型不能凭空造人）；
 * 2. 每个 `alias` 必须在该候选的**证据片段**里字面出现过（编造的别名砍掉）；
 * 3. 别名不能等于自己，组内去重。
 *
 * @param candidates 送进去的候选（含片段）
 * @param raw 模型输出
 * @returns 清洗后的建议
 */
export function sanitizeSuggestions(
  candidates: readonly SuggestCandidate[],
  raw: RawSuggestion
): SanitizedSuggestion {
  const byName = new Map(candidates.map((item) => [item.name, item]));
  const persons: SanitizedSuggestion["persons"] = [];
  const droppedAliases: SanitizedSuggestion["droppedAliases"] = [];
  const seenNames = new Set<string>();

  for (const person of raw.persons) {
    const candidate = byName.get(person.name);
    // 造出来的人：直接丢，不留 rejects（那不是「判断错误」，是无中生有）。
    if (candidate === undefined || seenNames.has(person.name)) continue;
    seenNames.add(person.name);

    const evidence = candidate.samples.join("\n");
    const aliases: string[] = [];
    for (const alias of person.aliases) {
      const trimmed = alias.trim();
      if (trimmed.length === 0 || trimmed === person.name) continue;
      if (aliases.includes(trimmed)) continue;
      /**
       * 关卡一：别名不能以**动词/助词**结尾。
       *
       * 实测模型会给出 `李贵忙`（「李贵忙道」的截断）、`雨村道` 这类「名字 + 动词」的组合，
       * 它们在片段里确实字面存在，但根本不是称谓。
       *
       * ⚠️ 为什么不改成「别名必须也在候选清单里」：试过，太严 —— `甄士隐` 因为分词被切成
       * 「甄 / 士隐」而不在候选里，于是 `士隐 = 甄士隐` 这种**正确**的分组被整条砍掉
       * （别名组从 9 掉到 4，其中 2 个还是错的）。形态规则能挡住噪声又不误伤全名。
       */
      if (TRAILING_FUNCTION_CHARS.test(trimmed.slice(-1))) {
        droppedAliases.push({
          name  : person.name,
          alias : trimmed,
          reason: "以动词/助词结尾，疑似「名字+动作」的截断"
        });
        continue;
      }
      // 关卡二：别名必须在证据片段里字面出现（防止模型凭空造写法）。
      if (!evidence.includes(trimmed)) {
        droppedAliases.push({
          name  : person.name,
          alias : trimmed,
          reason: "证据片段里找不到该写法"
        });
        continue;
      }
      aliases.push(trimmed);
    }

    persons.push({ name: person.name, aliases, reason: person.reason });
  }

  const rejects = raw.rejects.filter((item) => byName.has(item.name));
  return { persons, rejects, droppedAliases };
}

/** 构造提示词。 */
export function buildSuggestPrompts(
  bookTitle: string,
  candidates: readonly SuggestCandidate[]
): { system: string; user: string } {
  const system = [
    "你是中文古典小说的校勘助手。任务：判断给出的「候选名」里，哪些是同一个人的不同称呼。",
    "",
    "硬性规则：",
    "1. 只能依据我给的「原文片段」判断，不得使用你的背景知识补充。",
    "2. 拿不准就不要合并——漏并只是少一点收益，错并会让整张人物关系图错乱。",
    "3. aliases 里只能写片段中**原样出现过**的写法，不要改写、不要补充称谓。",
    "4. 同一个称呼可能指不同的人（如「太太」「老爷」），这类泛称一律放进 rejects。",
    "5. 只输出 JSON，不要任何解释文字。"
  ].join("\n");

  const blocks = candidates.map((item, index) => {
    const sampleText = item.samples.length === 0 ? "（无片段）" : item.samples.map((s) => `  · ${s}`).join("\n");
    return [
      `${String(index + 1)}. ${item.name}（出现 ${String(item.frequency)} 次，首见第 ${String(item.firstChapter)} 回）`,
      sampleText
    ].join("\n");
  });

  const user = [
    `作品：《${bookTitle}》`,
    `下面是 ${String(candidates.length)} 个候选名及其原文片段：`,
    "",
    blocks.join("\n"),
    "",
    "请输出 JSON：",
    `{"persons":[{"name":"候选名","aliases":["同人的其他写法"],"reason":"依据"}],"rejects":[{"name":"候选名","reason":"为什么不是人物"}]}`,
    "",
    "要求：",
    "- persons 只包含你**确定**是同一个人分组的候选；单个人的不必列出。",
    "- rejects 列出明显不是人物的候选（泛称、地名、书名等）。",
    "- 无法判断的候选直接跳过，不要为了凑数而猜测。"
  ].join("\n");

  return { system, user };
}

/** 从模型输出里剥掉可能的 ```json 围栏。 */
export function stripCodeFence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
  return (fenced?.[1] ?? text).trim();
}

/** 一次 L2 调用的结果。 */
export interface SuggestOutcome extends SanitizedSuggestion {
  model    : string;
  tokensIn : number;
  tokensOut: number;
  calls    : number;
}

/**
 * 调用模型生成建议。
 *
 * @param bookTitle 书名（只用于提示词上下文）
 * @param candidates 候选（调用方已按频次排序并截断）
 * @returns 清洗后的建议与用量
 */
export async function suggestAliasGroups(
  bookTitle: string,
  candidates: readonly SuggestCandidate[]
): Promise<SuggestOutcome> {
  const snapshot = getModelSnapshot();
  const { system, user } = buildSuggestPrompts(bookTitle, candidates);

  const result = await callWithRetry({
    model      : snapshot.extractModel,
    system,
    user,
    temperature: TEMPERATURE,
    maxTokens  : MAX_TOKENS
  });

  /**
   * 截断处理：177 个候选的 rejects 可能把 4096 token 吃满（实测撞过）。
   *
   * 走既有的 `repairTruncatedJson`（管线里同一套工具）—— 它会把末尾不完整的
   * 对象截掉并补全括号，代价是丢掉最后几条建议，但比整批失败好。
   */
  const repaired = repairTruncatedJson(result.text);
  const parsed = RawSuggestionSchema.safeParse(JSON.parse(repaired.text));
  if (!parsed.success) {
    // 解析失败不等于「没有建议」：抛出去让调用方决定是否重试或降级，
    // 静默返回空列表会让用户以为「模型认为没有别名」。
    throw new Error(`L2 输出不符合 schema：${parsed.error.issues[0]?.message ?? "unknown"}`);
  }

  return {
    ...sanitizeSuggestions(candidates, parsed.data),
    model    : snapshot.extractModel,
    tokensIn : result.usage.tokensIn,
    tokensOut: result.usage.tokensOut,
    calls    : 1
  };
}
