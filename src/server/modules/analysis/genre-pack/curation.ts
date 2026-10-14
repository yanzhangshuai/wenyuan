import { z } from "zod";

import { ENTITY_TYPES, type EntityType } from "@/lib/entities";
import { normalizeName } from "@/lib/text";

import { discoverHeadingCandidates, type NgramCandidate } from "./discovery";
import type { WorkPack } from "./types";

/**
 * N12 tier ③「**离线作品包生成器**」的 **LLM 半边** —— 纯函数骨架。
 *
 * 与本目录的 `discovery.ts`（确定性半边）**成对**：那半边负责「高召回」，
 * 这半边负责「把高召回变成可用词典」。两者**都必须离线**，都不在流水线内。
 *
 * ## 为什么必须分成两半（这不是洁癖）
 *
 * `discovery.ts` 的输出精度只有 **25% / 40%**（top-40，批 28 实测），
 * 而召回上限是 **83.1% / 73.4%**。要变成一份能用的词典，缺的是两件**性质完全不同**的事：
 *
 * | 半边 | 做什么 | 为什么必须分开量 |
 * | --- | --- | --- |
 * | **A 语义过滤** | 把候选里的联绵词/常用词剔掉 | 输入是**给定的候选表** → 可以对着表逐条验伪 |
 * | **B 补低频全名** | 补出候选表里没有、但书里确实有的专名 | 输入是**模型自己的常识** → **无法验伪** |
 *
 * 把 A 与 B 混在一次输出里，就**分不清**涨的那几点召回是「过滤对了」还是「模型编了」。
 * 所以本模块的输出是**两个独立桶**：`accepted`（**已通过候选表校验**）与
 * `supplied`（⚠️ **未经验证**）。`applyCuration` 默认**只写 accepted**。
 *
 * ## ⚠️ 候选清单装不下一次调用 —— 这是本模块存在「分批」的唯一理由
 *
 * `freedom = 0.6` 时儒林候选 **12,900** 条、红楼更多（批 31 实测，生产语料口径）。
 * 一条候选在提示词里约 4～6 个 token，输出每条判定还要更多 —— 一次调用**必然**
 * 撞 `maxTokens`，而截断的后果是**静默丢掉尾部候选**（正是 P3 二审 100% 空转的同一种病）。
 * 所以 `planCurationBatches` 把候选切成固定大小的批，**每批一次调用**，
 * 调用次数 = `⌈候选数 / batchSize⌉` —— 这是**成本随召回线性增长**的显式表达，
 * 也是「先看 `--dry-run` 的成本估算再决定花不花钱」的依据。
 *
 * ## ⛔ 本模块刻意**不** import `pipeline/`
 *
 * `pipeline/dictionary.ts` 依赖 `genre-pack`（取 `DEFAULT_GENRE_PACK`），
 * 因此 `genre-pack → pipeline` 会构成**循环依赖**。本模块需要的一切
 * （`normalizeName` / `ENTITY_TYPES` / `NgramCandidate`）都能从 lib 与本目录拿到，
 * 于是它**连 `pipeline/repair-json.ts` 都不能复用** —— JSON 容错只能自带一份**最小**的
 * （见 `extractJson`）。这是刻意的取舍：宁可有 30 行重复，也不制造依赖环。
 *
 * ## 可选的【回目】输入块（批 37，**A 臂**）
 *
 * 候选清单来自 `discoverNgrams(body)`，而 `body` **不含回目**（`parseChapters` 把回目行
 * 放进 `chapter.title`）→ 正文里一律只用简称、全名只出现在回目的人物，
 * **在候选通道里根本不存在**（批 34 实测：儒林 3 条 / 红楼 6 条）。
 *
 * 修法是给提示词加一个**可选**的独立输入块：【回目】原文（儒林 1235 字 / 红楼 2771 字）。
 * 它比「把回目候选 1577 / 3856 条塞进候选表」省一个数量级（批 34 实测 17.6× / 20.0×）。
 *
 * ⚠️ **它属于 A 臂（可证伪）**，不是 B 臂 —— 因为【回目】是**给定文本**：
 * 模型报出的名字可以**逐字**核对「它是否真的出现在回目里」。所以护栏可以收紧到
 * 「名字必须是**回目通道候选**（`discoverHeadingCandidates`，本地免费现算）」，
 * 而不是像 `supplied` 那样只能靠提示词压。这也是为什么它**不**并进 `supplied`。
 *
 * 两条不变量（都有单测钉住）：
 * 1. **不传 `headings` 时提示词逐字节不变** —— 否则「喂回目」这个动作无法做 A/B 对照；
 * 2. 回目块**每批都有**（不是只放第一批）—— 每批都可能碰到只在回目里出现的名字。
 *
 * ## 本模块不被流水线调用
 *
 * 它只被 `scripts/curate-work-pack.ts`（付费入口）与探针调用。
 * → 加它**不改变任何生产行为**（库与代码一致，不需重导、不需重跑 analyze）。
 * ⚠️ 但正因为如此，`pipeline/llm-callpoints.test.ts` 的「确定性阶段零 LLM」断言
 * **默认扫不到它**（那份断言只扫硬编码的 `pipeline/*.ts`）→ 已在本批**补上**对
 * `genre-pack/` 的覆盖（见该测试新增的 describe），把「新调用点在守卫下不可见」关掉。
 */

/** 作品词典里「人名」的词性码。取值依据见 `types.ts` 的 `WorkPack.properNouns`。 */
const POSTAG_PERSON = 128;
/** 作品词典里「非人名」的词性码（复用 `segmentit` 的地名标记）。 */
const POSTAG_NON_PERSON = 64;

/**
 * 每批默认候选条数。
 *
 * 取值理由：`maxTokens` 默认 4096（与 P0 词典分类同量级），一条判定输出约 20 token
 * → 单批输出约 `batchSize × 20`。取 **150** 时约 3000 token，**留出 25% 余量**，
 * 使单批不容易撞上限。⚠️ 这是一个**保守的默认**，不是实测最优值 ——
 * 真实最优要等一次付费运行拿到 token 实绩才能定（本批刻意不定死）。
 */
export const DEFAULT_CURATION_BATCH_SIZE = 150;

/** 模型返回的单条判定。`type` 允许缺失（缺失按 `PERSON` 兜底并计入诊断）。 */
const VerdictSchema = z.object({
  name    : z.string().min(1),
  accepted: z.boolean(),
  type    : z.string().optional()
});

/** 模型补出的单条专名（没有 `accepted` —— 它本来就不在候选表里）。 */
const SuppliedSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional()
});

/** 模型返回的整体形状。两个数组都可缺省（模型可能只回答其中一件事）。 */
const CurationResponseSchema = z.object({
  verdicts: z.array(VerdictSchema).optional(),
  supplied: z.array(SuppliedSchema).optional()
});

/** 一条被接受的专名。 */
export interface CurationEntry {
  /** 归一化后的名字（与 `discoverNgrams` 的候选口径一致）。 */
  readonly name: string;
  readonly type: EntityType;
}

/** 一次（或多次合并后的）策展结果。 */
export interface CurationResult {
  /**
   * 经模型判定为专名、**且通过候选表校验**的条目。
   *
   * 候选表 = 正文候选（`discoverNgrams(body)`）∪ 回目候选（传了 `headings` 时，
   * 由 `discoverHeadingCandidates` 本地现算）。两者都是**给定文本** → 可证伪，
   * 所以都算 `accepted`（与不可证伪的 `supplied` 是两件事）。
   */
  readonly accepted: readonly CurationEntry[];
  /**
   * 模型凭常识补出的、候选清单里没有的条目。
   *
   * ⚠️ **未经验证**：它既不在候选表里（无从对照），也可能在正文里出现 0 次
   * （`史太君` 全书只用 `贾母` 称呼）—— 所以**不能**用「正文命中」来筛。
   * 唯一正确的处置是**单列出来给人看**，因此 `applyCuration` 默认不写它。
   */
  readonly supplied: readonly CurationEntry[];
}

/**
 * 解析过程中的**丢弃计数**。
 *
 * 为什么要显式留档而不是静默丢：本仓库反复栽在「改动在图谱里不可见」上。
 * 「模型返回了 200 条、实际只用上 160 条」如果不留档，
 * 就会表现为「模型不太行」而不是「护栏吃掉了一批」—— 这两种原因要采取的行动完全相反。
 */
export interface CurationDiagnostics {
  /** 模型声称在候选里、但候选表查不到的条目（幻觉 / 改写字形）→ **已丢弃**。 */
  readonly unknownVerdicts  : readonly string[];
  /** `type` 取值不在 `ENTITY_TYPES` 里的条目 → **已按 `PERSON` 兜底**。 */
  readonly invalidTypes     : readonly string[];
  /** `supplied` 里其实在候选表中的条目（放错了桶）→ **已丢弃**。 */
  readonly misplacedSupplied: readonly string[];
  /** `supplied` 里的重复项（含与已接受项重复）→ **已丢弃**。 */
  readonly duplicateSupplied: readonly string[];
  /**
   * **回目来源**的接受项：不在**全书正文候选**里、但**逐字出现在回目**里（批 37）。
   *
   * 为什么要单列：这批条目走的是一条**新通道**，而本项目反复栽在「改动在图谱里不可见」上。
   * 不单列的话，「回目通道贡献了 0 条」与「回目通道没被启用」在读数上**完全一样**。
   * ⚠️ 它们**已通过**回目候选表校验，因此算 `accepted`（**不是** `supplied`）。
   * 🚨 **口径**：对照集是 `bodyUniverse`（**全书**正文候选），**不是**本批候选 ——
   * 用本批候选当对照会把「排名在 `--limit` 之外的正文候选」误算成回目独有（批 37 实测高估到 138 条）。
   */
  readonly headingVerdicts  : readonly string[];
}

/** 一批候选与它对应的提示词。 */
export interface CurationBatch {
  /** 从 0 开始的批号。 */
  readonly index     : number;
  /** 总批数。 */
  readonly total     : number;
  /** 本批候选（**原样引用**，顺序不变）。 */
  readonly candidates: readonly NgramCandidate[];
  readonly system    : string;
  readonly user      : string;
}

/** 单批的解析结果。 */
export interface CurationParseOutcome {
  /** 形状合法时的结果；形状不合法时为 `null`。 */
  readonly result     : CurationResult | null;
  readonly diagnostics: CurationDiagnostics;
  /** `not_json`（拿不到 JSON）/ `schema_invalid`（JSON 合法但形状不对）；成功为 `null`。 */
  readonly errorKind  : "not_json" | "schema_invalid" | null;
  /** 是否动用过「剥代码围栏 / 截取首尾花括号」这类容错。 */
  readonly repaired   : boolean;
}

/** 空诊断（便于合并与测试构造）。 */
function emptyDiagnostics(): CurationDiagnostics {
  return {
    unknownVerdicts  : [],
    invalidTypes     : [],
    misplacedSupplied: [],
    duplicateSupplied: [],
    headingVerdicts  : []
  };
}

/**
 * 构造一个「这批调用失败」的解析结果（**失败路径必须与其他路径同形**）。
 *
 * 为什么要抽出来：批 37 给 `CurationDiagnostics` 加字段时，失败路径是**手抄**的一份
 * 字面量 —— 手抄的那份漏了新字段，而 `tsc` 恰好抓到了（这是运气）。
 * 抽成一个函数后，「加字段」只有**一处**要改，失败路径**在结构上**不可能漂移。
 *
 * @returns 形状合法的失败结果（`errorKind` 为 `not_json`：拿不到可用 JSON）
 */
export function failedCurationOutcome(): CurationParseOutcome {
  return {
    result     : null,
    diagnostics: emptyDiagnostics(),
    errorKind  : "not_json",
    repaired   : false
  };
}

/**
 * 把模型返回的文本抽成 JSON 对象 —— **最小容错，失败即失败**。
 *
 * 只做三件事：去首尾空白 → 剥一层 Markdown 代码围栏 → 截取首个 `{` 到末个 `}`。
 * 不做「补逗号 / 补引号」这类修复：那属于 `pipeline/repair-json.ts` 的职责，
 * 而本模块**不能** import 它（循环依赖，见文件头）。
 *
 * @param raw 模型返回的原始文本
 * @returns 解析出的对象；失败返回 `null`
 */
function extractJson(raw: string): { value: unknown; repaired: boolean } | null {
  let text = raw.trim();
  let repaired = false;

  if (text.startsWith("```")) {
    repaired = true;
    text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "");
    text = text.trim();
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    if (first > 0 || last < text.length - 1) {
      repaired = true;
    }
    try {
      return { value: JSON.parse(text.slice(first, last + 1)) as unknown, repaired };
    } catch {
      // 截取后仍不是合法 JSON → 落到下面整体再试一次（可能本来就没有花括号）。
    }
  }

  // 没有花括号，或截取后解析失败 → 试整体解析。
  // ⚠️ 这一步是为了把「**形状不对**」与「**根本不是 JSON**」区分开：
  //    模型回一个 JSON 数组（`[1,2,3]`）时，正确的诊断是 `schema_invalid`
  //    （JSON 合法、契约不符），而不是 `not_json`（拿不到 JSON）。
  //    两者的处置完全不同 —— 前者要改提示词，后者要查截断。
  try {
    return { value: JSON.parse(text) as unknown, repaired };
  } catch {
    return null;
  }
}

/**
 * 把 `type` 字串解析成 `EntityType`。
 *
 * @param raw 模型给的 `type`（可能缺省或非法）
 * @returns 合法的类型；非法或缺省时为 `"PERSON"`（**兜底，不是报错**）
 */
function resolveType(raw: string | undefined): EntityType {
  const candidate = raw?.trim().toUpperCase();
  return (ENTITY_TYPES as readonly string[]).includes(candidate ?? "")
    ? (candidate as EntityType)
    : "PERSON";
}

/** 判断某字串是否是合法的 `EntityType` 字面量。 */
function isEntityType(raw: string | undefined): boolean {
  return (ENTITY_TYPES as readonly string[]).includes(raw?.trim().toUpperCase() ?? "");
}

/**
 * 把一批候选渲染成提示词里的清单。
 *
 * 口径与 `pipeline/dictionary.ts` 的 `renderCandidateDictionary` **一致**（`写法(次数)`），
 * 但**不 import 它**（循环依赖）—— 这两处若漂移，表现为「模型看到的清单与我们对不上」，
 * 属于难查的静默问题，故在单测里用同一个样例把两侧格式钉死。
 *
 * @param candidates 本批候选
 * @returns 每行一条的文本
 */
function renderCandidates(candidates: readonly NgramCandidate[]): string {
  return candidates.map((candidate) => `${candidate.gram}(${String(candidate.frequency)})`).join("\n");
}

/**
 * 策展的系统提示词（**常量**）。
 *
 * 设计要点：
 * - 明确**两件事分开回答**（`verdicts` / `supplied`），与模块的「两个桶」一一对应；
 * - 补全那一段显式写「宁可少补，不可编造」—— 因为 `supplied` 无法被程序验伪，
 *   只能靠提示词先压一道；
 * - 要求「只输出 JSON」，与 `extractJson` 的最小容错对齐。
 */
export const CURATION_SYSTEM_PROMPT = `你是中文古典小说专名筛选器。给定一批从正文统计出的高频候选（附出现次数），完成两件**互相独立**的任务。

## 任务 A：过滤（回答在 verdicts 里）
逐个判断候选是不是**值得进人物图谱的实体专名**。
- 是：accepted 填 true，并给出 type。
- 不是：accepted 填 false。以下一律不是：联绵词（怂恿、朦胧、踌躇）、普通名词、动词短语、
  时间词、泛称（众人、那人）、分词错误产生的碎词。

## 任务 B：补全（回答在 supplied 里）
凭你对这本书的常识，补出**候选清单里没有、但你确定书里有的实体专名** ——
尤其是正文里只用简称、全名很少出现的那些（例如只用「贾母」称呼、全名几乎不出现）。
⚠️ **只写你确实知道的**；不确定就不要写。**宁可少补，不可编造** ——
补错的名字会污染整本词典，比漏补严重得多。

type 取值只能是：PERSON、LOCATION、ORGANIZATION、CONCEPT。

## 输出格式
只输出一个 JSON 对象，不要解释文字、不要 Markdown 代码围栏：
{"verdicts":[{"name":"范进","accepted":true,"type":"PERSON"},{"name":"如今","accepted":false}],"supplied":[{"name":"史太君","type":"PERSON"}]}

没有把握的项就省略该数组，例如 {"verdicts":[...]} 或 {"supplied":[...]}。`;

/**
 * 【回目】输入块的说明段（**可选**，批 37）。
 *
 * 只在调用方**显式**传了 `headings` 时追加到系统提示词。
 * ⚠️ 之所以不把它并进 `CURATION_SYSTEM_PROMPT`：不传回目的调用点必须拿到
 * **逐字节相同**的提示词，否则「喂回目」这个动作就无法做 A/B 对照（有单测钉住）。
 */
export const CURATION_HEADING_TASK = `## 任务 C：从【回目】里取全名（**同样**回答在 verdicts 里）
下面【回目】是本书**各章标题的原文**。回目里常常出现正文中只用简称的人物**全名**
（正文写「贾母」、回目写「史太君」）。把回目里出现的**实体专名**也一并判断，
与候选清单里的候选**用同一个 verdicts 数组**回答（是专名就 accepted 填 true）。
⚠️ **只报回目原文里逐字出现过的名字** —— 回目是给定文本，可以逐字核对；
   凭印象改写字形会被程序当作「幻觉」丢弃。`;

/**
 * 把候选切成若干批，并为每批构建提示词。
 *
 * @param candidates 候选清单（通常来自 `discoverNgrams` + `selectByFreedom`）
 * @param batchSize 每批条数上限（正整数）
 * @param headings 回目行（`loadBookBody` 的 `headings`）。**传空数组即完全退回旧行为**
 *   （提示词逐字节不变）；非空时追加一个独立的【回目】输入块 + 任务 C 说明。
 * @returns 批次列表；候选为空时返回空数组
 * @throws `batchSize` 不是正整数时抛出（**不静默兜底** —— 静默兜底会让成本估算失真）
 */
export function planCurationBatches(
  candidates: readonly NgramCandidate[],
  batchSize: number = DEFAULT_CURATION_BATCH_SIZE,
  headings: readonly string[] = []
): CurationBatch[] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`batchSize 必须是正整数，收到：${String(batchSize)}`);
  }
  // ⚠️ 回目块**每批都要有** —— 不是只放第一批：每批都可能碰到只在回目里出现的名字。
  const headingBlock =
    headings.length > 0
      ? `\n\n【回目】（共 ${String(headings.length)} 行，原文照抄）\n${headings.join("\n")}`
      : "";
  const system =
    headings.length > 0 ? `${CURATION_SYSTEM_PROMPT}\n\n${CURATION_HEADING_TASK}` : CURATION_SYSTEM_PROMPT;
  const total = Math.ceil(candidates.length / batchSize);
  const batches: CurationBatch[] = [];
  for (let index = 0; index < total; index += 1) {
    const slice = candidates.slice(index * batchSize, (index + 1) * batchSize);
    const header = `【候选清单】（第 ${String(index + 1)}/${String(total)} 批，共 ${String(slice.length)} 条）`;
    batches.push({
      index,
      total,
      candidates: slice,
      system,
      user      : `${header}\n${renderCandidates(slice)}${headingBlock}`
    });
  }
  return batches;
}

/**
 * 解析**单批**模型返回。
 *
 * 幻觉护栏是这里最重要的一段：模型会给出候选表里根本没有的名字
 * （改写字形、或干脆凭印象编）。这些条目**必须**被丢弃并计数 ——
 * 若放行，`accepted` 就退化成了 `supplied`（不可验证），两个桶的区分失去意义。
 *
 * @param raw 模型返回的原始文本
 * @param candidates 本批候选（**必须是构建该批提示词时用的那一份**）
 * @param headings 回目行。**传了它，护栏就同时认「回目通道候选」** —— 这是 A 臂能成立的
 *   前提：名字只要**逐字出现在回目**里就是**可核对**的，因此可以放行并计入 `headingVerdicts`。
 *   不传则完全退回旧口径（回目名字一律按幻觉丢弃）。
 * @param bodyUniverse **归因**用的全书正文候选（不是本批的 150 条）。
 *   🚨 为什么必须单独给：`headingVerdicts` 要回答的是「**这条是不是回目独有**」。
 *   若拿**本批候选**当对照，那么「在正文候选表里、但排名在 `--limit` 之外」的名字
 *   会被**误算成回目独有** —— 批 37 实测这个口径把读数从真值抬到了 **138 条**（严重高估）。
 *   ⚠️ 不传则退化为 `candidates`（即那个**会高估**的口径），仅用于单测与兼容。
 * @returns 解析结果 + 诊断
 */
export function parseCurationResponse(
  raw: string,
  candidates: readonly NgramCandidate[],
  headings: readonly string[] = [],
  bodyUniverse: readonly NgramCandidate[] = []
): CurationParseOutcome {
  const diagnostics = emptyDiagnostics();
  const extracted = extractJson(raw);
  if (extracted === null) {
    return { result: null, diagnostics, errorKind: "not_json", repaired: false };
  }

  const parsed = CurationResponseSchema.safeParse(extracted.value);
  if (!parsed.success) {
    return { result: null, diagnostics, errorKind: "schema_invalid", repaired: extracted.repaired };
  }

  // ⚠️ 两侧都必须归一化后再比：模型可能给 `范进 `（带空格）这类写法。
  //    口径与 `auditDictionary` 一致（那边也是 `normalizeName` 后比较）。
  //
  // 两个集合，**用途不同，不要合并**：
  //   `known`        = 护栏（**能不能收**）= 本批候选 ∪ 回目候选；
  //   `bodyUniverse` = 归因（**算不算回目独有**）= 全书正文候选。
  const known = new Set(candidates.map((candidate) => normalizeName(candidate.gram)));
  const bodyKnown = new Set(
    (bodyUniverse.length > 0 ? bodyUniverse : candidates).map((candidate) => normalizeName(candidate.gram))
  );
  // 回目候选**本地现算**（`discoverHeadingCandidates` 是纯确定性函数、不花钱）——
  // 所以「喂回目」的额外 token 成本只花在提示词上，护栏这一侧是免费的。
  if (headings.length > 0) {
    for (const headingCandidate of discoverHeadingCandidates(headings)) {
      const normalized = normalizeName(headingCandidate.gram);
      if (normalized.length > 0) {
        known.add(normalized);
      }
    }
  }

  const accepted: CurationEntry[] = [];
  const acceptedSeen = new Set<string>();
  const unknownVerdicts: string[] = [];
  const invalidTypes: string[] = [];
  const headingVerdicts: string[] = [];

  for (const verdict of parsed.data.verdicts ?? []) {
    const normalized = normalizeName(verdict.name);
    if (normalized.length === 0) {
      continue;
    }
    // ⚠️ 护栏：候选表（正文候选 ∪ 回目候选）里查不到 → 幻觉/改写，丢弃并计数。
    if (!known.has(normalized)) {
      unknownVerdicts.push(verdict.name);
      continue;
    }
    if (!verdict.accepted) {
      continue;
    }
    if (acceptedSeen.has(normalized)) {
      continue;
    }
    if (!isEntityType(verdict.type)) {
      invalidTypes.push(verdict.name);
    }
    acceptedSeen.add(normalized);
    accepted.push({ name: normalized, type: resolveType(verdict.type) });
    // 回目来源：不在**正文**候选表里 → 单列出来。
    // 它**已通过**回目候选表校验，所以算 `accepted`（不是 `supplied`）。
    if (!bodyKnown.has(normalized)) {
      headingVerdicts.push(verdict.name);
    }
  }

  const supplied: CurationEntry[] = [];
  const suppliedSeen = new Set<string>();
  const misplacedSupplied: string[] = [];
  const duplicateSupplied: string[] = [];

  for (const item of parsed.data.supplied ?? []) {
    const normalized = normalizeName(item.name);
    if (normalized.length === 0) {
      continue;
    }
    // 放错了桶：它在候选表里 → 应该走 verdicts。丢弃并计数（不是错误，但要看得见）。
    if (known.has(normalized)) {
      misplacedSupplied.push(item.name);
      continue;
    }
    if (acceptedSeen.has(normalized) || suppliedSeen.has(normalized)) {
      duplicateSupplied.push(item.name);
      continue;
    }
    if (!isEntityType(item.type)) {
      invalidTypes.push(item.name);
    }
    suppliedSeen.add(normalized);
    supplied.push({ name: normalized, type: resolveType(item.type) });
  }

  return {
    result     : { accepted, supplied },
    diagnostics: { unknownVerdicts, invalidTypes, misplacedSupplied, duplicateSupplied, headingVerdicts },
    errorKind  : null,
    repaired   : extracted.repaired
  };
}

/** 合并多个单批结果的产出。 */
export interface MergedCuration {
  readonly result       : CurationResult;
  readonly diagnostics  : CurationDiagnostics;
  /** 形状不合法（`not_json` / `schema_invalid`）的批号。**空数组才是全成功**。 */
  readonly failedBatches: readonly number[];
}

/**
 * 合并各批结果。
 *
 * ⚠️ 合并**必须**跨批去重：同一专名可能同时出现在两批候选里
 * （n-gram 的重叠计数会让 `杜少` 与 `杜少卿` 分居两批），
 * 不去重就会让同一名字在词典里出现两次 —— 而 `WorkPack.properNouns` 是**列表**、
 * 不保证唯一，重复条目会让 `renderSegmentitDict` 产出重复行（静默，不报错）。
 *
 * @param outcomes 各批结果（顺序即批序）
 * @param failedBatches 形状不合法的批号（由调用方按批序记录）
 * @returns 合并结果
 */
export function mergeCurationOutcomes(
  outcomes: readonly CurationParseOutcome[],
  failedBatches: readonly number[] = []
): MergedCuration {
  const accepted: CurationEntry[] = [];
  const supplied: CurationEntry[] = [];
  const acceptedSeen = new Set<string>();
  const suppliedSeen = new Set<string>();
  const unknownVerdicts: string[] = [];
  const invalidTypes: string[] = [];
  const misplacedSupplied: string[] = [];
  const duplicateSupplied: string[] = [];
  const headingVerdicts: string[] = [];

  for (const outcome of outcomes) {
    unknownVerdicts.push(...outcome.diagnostics.unknownVerdicts);
    invalidTypes.push(...outcome.diagnostics.invalidTypes);
    misplacedSupplied.push(...outcome.diagnostics.misplacedSupplied);
    duplicateSupplied.push(...outcome.diagnostics.duplicateSupplied);
    headingVerdicts.push(...outcome.diagnostics.headingVerdicts);
    if (outcome.result === null) {
      continue;
    }
    for (const entry of outcome.result.accepted) {
      if (acceptedSeen.has(entry.name)) {
        continue;
      }
      acceptedSeen.add(entry.name);
      accepted.push(entry);
    }
    for (const entry of outcome.result.supplied) {
      if (suppliedSeen.has(entry.name) || acceptedSeen.has(entry.name)) {
        duplicateSupplied.push(entry.name);
        continue;
      }
      suppliedSeen.add(entry.name);
      supplied.push(entry);
    }
  }

  return {
    result     : { accepted, supplied },
    diagnostics: { unknownVerdicts, invalidTypes, misplacedSupplied, duplicateSupplied, headingVerdicts },
    failedBatches
  };
}

/** 空的（零专名）作品包。 */
export function emptyWorkPack(id: string, label: string, properNounFrequency: number): WorkPack {
  return { id, label, properNouns: [], properNounFrequency };
}

/** `applyCuration` 的选项。 */
export interface CurationApplyOptions {
  /**
   * 是否把**未经验证**的 `supplied` 也写进词典。默认 **false**。
   *
   * ⚠️ 默认 `false` 是本模块最重要的一条安全默认：`supplied` 无法被程序验伪，
   * 放进去就等于「让模型直接改词典」。要放必须**显式**打开，
   * 且调用方应先把 `supplied` 打给人看过。
   */
  readonly includeSupplied?: boolean;
}

/** 合并进作品包的统计。 */
export interface CurationApplySummary {
  readonly addedAccepted  : readonly string[];
  readonly addedSupplied  : readonly string[];
  /** 已在原词典里、本次跳过的条目。 */
  readonly skippedExisting: readonly string[];
  readonly totalEntries   : number;
}

/** 合并结果（新包 + 统计）。 */
export interface CurationApplyResult {
  readonly pack   : WorkPack;
  readonly summary: CurationApplySummary;
}

/**
 * 把策展结果合并进作品包（**返回新包，不修改入参**）。
 *
 * 语义：
 * - 原条目**原样保留且顺序不变**（人工录入的 118 / 173 条是承重件，不能被生成器重排）；
 * - 新增条目**追加**在尾部；
 * - 按 `normalizeName` 去重（与 `auditDictionary` 的口径一致）；
 * - 词性码：`PERSON → 128`，其余 `→ 64`。
 *
 * @param base 基础作品包
 * @param result 策展结果
 * @param options 选项（见 `includeSupplied`）
 * @returns 新包与统计
 */
export function applyCuration(
  base: WorkPack,
  result: CurationResult,
  options: CurationApplyOptions = {}
): CurationApplyResult {
  const entries: [string, number][] = [];
  const seen = new Set<string>();
  const skippedExisting: string[] = [];

  for (const [surface, postag] of base.properNouns) {
    const normalized = normalizeName(surface);
    if (normalized.length === 0) {
      continue;
    }
    if (seen.has(normalized)) {
      skippedExisting.push(surface);
      continue;
    }
    seen.add(normalized);
    entries.push([surface, postag]);
  }

  const addedAccepted: string[] = [];
  for (const entry of result.accepted) {
    if (seen.has(entry.name)) {
      skippedExisting.push(entry.name);
      continue;
    }
    seen.add(entry.name);
    addedAccepted.push(entry.name);
    entries.push([entry.name, entry.type === "PERSON" ? POSTAG_PERSON : POSTAG_NON_PERSON]);
  }

  const addedSupplied: string[] = [];
  if (options.includeSupplied === true) {
    for (const entry of result.supplied) {
      if (seen.has(entry.name)) {
        skippedExisting.push(entry.name);
        continue;
      }
      seen.add(entry.name);
      addedSupplied.push(entry.name);
      entries.push([entry.name, entry.type === "PERSON" ? POSTAG_PERSON : POSTAG_NON_PERSON]);
    }
  }

  return {
    pack: {
      id                 : base.id,
      label              : base.label,
      properNouns        : entries,
      properNounFrequency: base.properNounFrequency
    },
    summary: {
      addedAccepted,
      addedSupplied,
      skippedExisting,
      totalEntries: entries.length
    }
  };
}

/**
 * 估算策展所需调用次数与**粗略** token 量级。
 *
 * ⚠️ 这是**量级估算**，不是账单预测：真实 token 要等一次运行才能校准
 * （与 `client.ts` 里「单价表必须对得上模型名」是同一类谨慎）。
 * 它的用途是**在花钱之前给出一个可比较的刻度**，而不是精确预算。
 *
 * @param candidateCount 候选总数
 * @param batchSize 每批条数
 * @param headingChars 回目原文的总字数（不喂回目时传 0）。
 *   ⚠️ 回目块**每批都要发**，所以它的成本是 `调用次数 × 每批回目 token` ——
 *   不乘调用次数会**低估**一个数量级（批 37 实测：儒林回目 1235 字 ≈ 1577 token/次）。
 * @returns 调用次数与输入/输出的量级估算
 */
export function estimateCurationCost(
  candidateCount: number,
  batchSize: number = DEFAULT_CURATION_BATCH_SIZE,
  headingChars = 0
): { calls: number; approxInputTokens: number; approxOutputTokens: number } {
  const calls = Math.ceil(candidateCount / batchSize);
  // 系统提示约 400 token；每批固定开销（批头 + 说明）约 100。
  // 回目块的换算比：批 34 实测 1235 字 → 1577 token（≈ 1.28），取 1.3 作上界估计。
  const headingTokensPerCall = Math.ceil(headingChars * 1.3);
  const approxInputTokens = calls * (500 + batchSize * 6 + headingTokensPerCall);
  // 每条候选一条判定，约 20 token（`{"name":"…","accepted":true,"type":"PERSON"},`）。
  const approxOutputTokens = candidateCount * 20;
  return { calls, approxInputTokens, approxOutputTokens };
}
