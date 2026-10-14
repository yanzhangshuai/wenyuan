import { normalizeName } from "@/lib/text";

import { auditDictionary, countOccurrences, type NgramCandidate } from "./discovery";
import type { WorkPack } from "./types";

/**
 * 作品包的**三条审计**（批次 38）—— 生成器缺失的「质检半边」。
 *
 * ## 为什么要有这个模块
 *
 * 参考项目 AI-Reader-V2 的 P0 是「**统计候选 → LLM 分类成白名单**」；
 * 我们借了它的**消费端**（拿词典做锚定），没借**生产端**（自动造词典）
 * → 于是 `works/*.ts` 变成**手编源文件**，每一次改进都成了一次手工编辑（见 §2.F 发现二）。
 *
 * 本模块把「手工编辑时靠人记得检查」的三件事变成**可重复的纯函数**：
 *
 * | 审计 | 抓什么 | 批 37 里对应的手工动作 |
 * | --- | --- | --- |
 * | `deadEntries` | 原文（**正文 + 回目**）出现 **0** 次的条目 | 手删 8 条（`王三姑娘` … `玄武湖`） |
 * | `prefixHazards` | 条目是**正文里更长高频名**的**严格前缀** | 手工撤下 `王太` |
 * | `variantSuggestions` | 死条目的**一字异文**（语料里有证据的） | 手工把 `玄武湖` 换成 `元武湖` |
 *
 * ## 🚨 口径：原文 = 正文 + 回目（不是「正文」）
 *
 * `parseChapters` 把回目行放进 `chapter.title`、**不进** `chapter.text`
 * → 「正文 0 次」会把**只在回目里出现**的活条目误判成死条目。
 * 批 36 修过这个 bug（儒林 10 → 8）。本模块**直接复用** `auditDictionary`
 * （而不是重写一遍），以免口径二次漂移。
 *
 * ## 🚨 `prefixHazards` 为什么是**结构上必要**的
 *
 * `findPrefixConflicts`（注册期守卫）只比**包内**条目。于是
 * 「包内条目是**包外**更长名字的前缀」（`王太` ⊂ `王太太`）**它看不见** ——
 * 词典里有 `王太` → 分词器把 `王太太` 切成 `王太|太`
 * → 三个**别人**的名字一起从候选表消失，而 `王太` 的频次被抬高、在 P5 抢走规范名 → **错并**。
 * ## 🚨 判据为什么是**频次比**，以及它为什么只是**提案**
 *
 * 第一版判据是「条目 ⊂ 过闸候选」，实测**误报 93 条** ——
 * 因为候选集里全是「名 + 动词」n-gram（`杜少卿叫` `王冕送` `周进跟`），
 * 它们是**正常切分**，不是更长的名字。
 *
 * 真正区分两者的是**频次比** `候选频次 / 条目频次`：
 *
 * | 对 | 比值 | 是不是隐患 |
 * | --- | --- | --- |
 * | `王太`(63) ⊂ `王太守`(25) | **0.40** | ✅ 是（`太守` 不是独立词，切开即坏） |
 * | `王太`(63) ⊂ `王太太`(20) | **0.32** | ✅ 是 |
 * | `汶上`(9) ⊂ `汶上县`(8) | **0.89** | ✅ 是（金标口径：只收长形式） |
 * | `杜少卿`(321) ⊂ `杜少卿叫`(6) | 0.019 | ❌ 否（`叫` 是动词，切开正常） |
 * | `王冕`(70) ⊂ `王冕送`(2) | 0.029 | ❌ 否 |
 *
 * 阈值 **0.3** 是**启发式**（不是定理）→ 所以 `prefixHazards` 是**提案**，
 * **不自动删条目**；撤下决策记在显式的 `withdrawals` 表里（见 `planPackEntries`）。
 * ⚠️ 想让这一步**全自动**，正确的路是把隐患候选**送进策展步骤**（与回目通道并列）——
 * 那需要一次付费跑，属下一步。
 *
 * ⚠️ 刻意**不**用「嵌入率」（条目后面紧跟汉字的比例）：古典白话里名字后面几乎总跟动词
 * （`杜少卿道`），实测 66/135 条命中、误报 ≈100%。
 */

/** 频次比阈值：候选频次 / 条目频次 ≥ 此值即视为隐患。**启发式**，见文件头。 */
export const PREFIX_HAZARD_RATIO = 0.3;

/** 审计输入。 */
export interface PackAuditInput {
  /** 正文（**不含**回目行；口径同 `auditDictionary`）。 */
  readonly body                  : string;
  /** 回目行（章节标题原文）。 */
  readonly headings              : readonly string[];
  /**
   * 对照集：**过自由度闸**的正文候选。
   *
   * 用「候选」而不是「所有 n-gram」是因为候选表是「正文里的高频名」的操作化定义
   * （与生产 `scanBookCandidates` 的截断口径同源）。
   */
  readonly candidates            : readonly NgramCandidate[];
  /** 一字异文的**最低出现次数**。默认 `2`（与 `DISCOVERY_DEFAULTS.minFrequency` 同量级）。 */
  readonly minVariantOccurrences?: number;
}

/** 前缀隐患：`entry` 是 `shadowed` 的严格前缀，且后者频次占比不低。 */
export interface PrefixHazard {
  readonly entry            : string;
  readonly shadowed         : string;
  readonly shadowedFrequency: number;
  /** `shadowedFrequency / entryFrequency`，见文件头的判据说明。 */
  readonly ratio            : number;
}

/** 一字异文建议：`dead` 在原文 0 次，而 `replacement` 有语料证据。 */
export interface VariantSuggestion {
  readonly dead       : string;
  readonly replacement: string;
  readonly occurrences: number;
}

/** 审计报告。 */
export interface PackAuditReport {
  /** 归一化去重后的条目。 */
  readonly entries           : readonly string[];
  /** 原文（正文 + 回目）0 次 → 可删（**删除是行为中性**：分词器从没见过它）。 */
  readonly deadEntries       : readonly string[];
  /** 正文 0 次但回目里有 → **活条目，不能删**。 */
  readonly headingOnlyEntries: readonly string[];
  /** 条目是正文里更长高频名的严格前缀 → 会静默破坏后者。 */
  readonly prefixHazards     : readonly PrefixHazard[];
  /** 死条目的一字异文（语料里有证据）。 */
  readonly variantSuggestions: readonly VariantSuggestion[];
}

/** 汉字判定：一字异文只接受**全汉字**窗口，避免把标点窗口算成异文。 */
const CJK_ONLY = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+$/u;

/** 把条目数组包成一个只用于审计的 `WorkPack`（词性取 PERSON，审计不看词性）。 */
function asAuditPack(entries: readonly string[]): WorkPack {
  return {
    id                 : "__audit__",
    label              : "（审计用）",
    properNouns        : entries.map((entry) => [entry, 128] as const),
    properNounFrequency: 100_000
  };
}

/** 归一化去重（口径与 `auditDictionary` 内部一致）。 */
export function normalizeEntries(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeName(entry);
    if (normalized.length > 0) {
      seen.add(normalized);
    }
  }
  return [...seen];
}

/**
 * 找一字异文：对每个死条目，扫描正文里**同长度、全汉字、恰差一个字**的窗口。
 *
 * 为什么这条规则是**通用**的：它只用「语料里有没有这个写法」这一个事实，
 * 不含任何书名/时代的先验（`玄武湖` → `元武湖` 是避讳，但规则不需要知道避讳）。
 *
 * @param deadEntries 死条目（原文 0 次）
 * @param body 正文
 * @param minOccurrences 最低出现次数
 * @returns 按出现次数降序的建议
 */
function findVariantSuggestions(
  deadEntries: readonly string[],
  body: string,
  minOccurrences: number
): VariantSuggestion[] {
  const suggestions: VariantSuggestion[] = [];

  // 按长度分组，避免对每个死条目各扫一遍正文。
  const byLength = new Map<number, string[]>();
  for (const entry of deadEntries) {
    const chars = Array.from(entry);
    const bucket = byLength.get(chars.length);
    if (bucket === undefined) {
      byLength.set(chars.length, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  for (const [length, entries] of byLength) {
    if (length < 2) {
      continue;
    }
    // 该长度下所有全汉字窗口的频次表。
    const counts = new Map<string, number>();
    for (let start = 0; start + length <= body.length; start += 1) {
      const window = body.slice(start, start + length);
      if (!CJK_ONLY.test(window)) {
        continue;
      }
      counts.set(window, (counts.get(window) ?? 0) + 1);
    }

    for (const dead of entries) {
      const deadChars = Array.from(dead);
      let best: VariantSuggestion | null = null;
      for (const [window, occurrences] of counts) {
        if (occurrences < minOccurrences || window === dead) {
          continue;
        }
        const windowChars = Array.from(window);
        let distance = 0;
        for (let index = 0; index < length; index += 1) {
          if (deadChars[index] !== windowChars[index]) {
            distance += 1;
            if (distance > 1) {
              break;
            }
          }
        }
        if (distance !== 1) {
          continue;
        }
        if (best === null || occurrences > best.occurrences) {
          best = { dead, replacement: window, occurrences };
        }
      }
      if (best !== null) {
        suggestions.push(best);
      }
    }
  }

  return suggestions.sort((left, right) => right.occurrences - left.occurrences);
}

/** 跑三条审计。纯函数：无 IO、无 LLM、无随机。 */
export function auditPack(entries: readonly string[], input: PackAuditInput): PackAuditReport {
  const normalized = normalizeEntries(entries);
  const pack = asAuditPack(normalized);

  // 口径走生产函数（原文 = 正文 + 回目），不在这里重写一遍。
  const base = auditDictionary(input.body, pack, input.candidates, input.headings);

  // 判据 1：条目 ⊂ 过闸候选，**且频次比 ≥ 阈值**（`findPrefixConflicts` 看不见的那一类）。
  const frequencyOf = new Map(input.candidates.map((candidate) => [candidate.gram, candidate.frequency]));
  const prefixHazards: PrefixHazard[] = [];
  for (const entry of normalized) {
    const entryFrequency = frequencyOf.get(entry);
    if (entryFrequency === undefined || entryFrequency <= 0) {
      // 条目自己不在候选集里 → 算不出比值，跳过（宁可漏报，不可乱报）。
      continue;
    }
    for (const candidate of input.candidates) {
      if (candidate.gram === entry || !candidate.gram.startsWith(entry)) {
        continue;
      }
      const ratio = candidate.frequency / entryFrequency;
      if (ratio < PREFIX_HAZARD_RATIO) {
        continue;
      }
      prefixHazards.push({
        entry,
        shadowed         : candidate.gram,
        shadowedFrequency: candidate.frequency,
        ratio
      });
    }
  }

  const variantSuggestions = findVariantSuggestions(
    base.deadEntries,
    input.body,
    input.minVariantOccurrences ?? 2
  );

  return {
    entries           : normalized,
    deadEntries       : [...base.deadEntries].sort(),
    headingOnlyEntries: [...base.headingOnlyEntries].sort(),
    prefixHazards     : prefixHazards.sort((left, right) => left.entry.localeCompare(right.entry)),
    variantSuggestions
  };
}

/** 应用审计后的计划。 */
export interface PackPlan {
  /** 保留的条目（按原顺序）。 */
  readonly kept   : readonly string[];
  /** 被删的条目。 */
  readonly dropped: readonly string[];
  /** 新增的条目（来自一字异文映射）。 */
  readonly added  : readonly string[];
}

/**
 * 把审计结果落成一个**确定的**条目计划。
 *
 * 三条规则：
 * 1. **删死条目**（`deadEntries`）—— 原文 0 次。⚠️ **行为中性**：分词器从没见过它，
 *    删掉不改变任何切分。**这条可以自动做**。
 * 2. **删撤下条目**（`withdrawals`）—— 显式的、可审阅的小表。
 *    ⚠️ **刻意不自动采纳 `prefixHazards`**：「频次比 ≥ 0.3」是**启发式**，
 *    而「`王太` 必须走」是**语义判断**（它是三个别人称谓的前缀）。判断必须留痕。
 * 3. **按 `variants` 补异文** —— 死条目的替换写法。
 *
 * 🚨 为什么规则 2/3 要**显式的表**而不是让程序静默决定：
 *    「一字之差」与「频次比高」都只是**必要**条件，不是充分条件
 *    （`王三姑娘` → `王二姑娘` 也差一字，但不是同一人的异文）。
 *    把判断落成**极小、可审阅、一次写定永久复用**的表 —— 这正是本项目
 *    「**能枚举的用正则，不能枚举的用词典**」的取向；而**产物**（`works/*.ts`）不再手编。
 *
 * @param entries 原始条目（顺序敏感）
 * @param report `auditPack` 的输出
 * @param options `variants`：死条目 → 替换写法；`withdrawals`：显式撤下的条目
 * @returns 计划
 */
export interface PackPlanOptions {
  readonly variants?   : Readonly<Record<string, string>>;
  readonly withdrawals?: readonly string[];
}

export function planPackEntries(
  entries: readonly string[],
  report: PackAuditReport,
  options: PackPlanOptions = {}
): PackPlan {
  const variantMap = options.variants ?? {};
  const dead = new Set(report.deadEntries);
  const withdrawn = new Set(options.withdrawals ?? []);

  const kept: string[] = [];
  const dropped: string[] = [];
  for (const entry of entries) {
    if (dead.has(entry) || withdrawn.has(entry)) {
      dropped.push(entry);
      continue;
    }
    kept.push(entry);
  }

  const present = new Set(kept);
  const added: string[] = [];
  for (const entry of dropped) {
    const replacement = variantMap[entry];
    if (replacement === undefined || present.has(replacement)) {
      continue;
    }
    present.add(replacement);
    added.push(replacement);
  }

  return { kept, dropped, added };
}

/** 便捷函数：从候选算「一字异文」的出现次数（供报告用）。 */
export function countInBody(body: string, needle: string): number {
  return countOccurrences(body, needle);
}
