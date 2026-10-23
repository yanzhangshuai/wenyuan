/**
 * 从全文里补充「称谓型候选」（纯函数，零依赖）。
 *
 * ## 为什么需要这一层
 *
 * L1 的分词候选只包含**被切成整词的专名**。实测《红楼梦》跑出来 145 个专名、
 * 但别名组只有 3 组 —— 因为「宝二爷」「林姑娘」「琏二奶奶」这类称谓
 * 在分词器眼里是「普通词 + 后缀」，根本进不了候选清单，
 * 于是 L2 只能在「贾政 / 贾存周 / 政老爷」这种已经被切开的里面找关系。
 *
 * 别名组是 P5 归并的**唯一强依据**（见 `WorkPack.aliasGroups` 的说明），
 * 漏并的代价是实体永久碎片化。所以这里用**字面后缀规则**把称谓捞回来：
 * 它不判断「是谁的称谓」，只负责「让这些写法进入候选，交给 L2 分组」。
 *
 * ## 为什么用后缀而不是「X + 人名」组合
 *
 * 组合枚举会爆炸（200 个名字 × 12 个后缀 = 2400 个候选），且大部分在原文里不存在。
 * 直接用后缀扫全文，得到的**都是真实出现过的写法**，频次也现成。
 */

/**
 * 称谓后缀（按长度降序，保证最长匹配优先）。
 *
 * 只收**古典白话小说**里高频、且几乎不会误伤普通词的后缀。
 * 「夫人」放在里面是安全的：`王夫人` 是称谓，`夫人` 单独出现会被频次门槛与 L2 的 rejects 过滤。
 */
const APPELLATION_SUFFIXES = [
  "二奶奶",
  "大奶奶",
  "姑娘",
  "奶奶",
  "太太",
  "夫人",
  "公子",
  "相公",
  "小姐",
  "姥姥",
  "姨娘",
  "婶婶",
  "妈妈",
  "二爷",
  "大爷",
  "老爷",
  "少爷",
  "爷"
] as const;

/** 前缀最多取几个字（「琏二奶奶」= 3，「宝二爷」= 2）。 */
const MAX_PREFIX_CHARS = 3;

/**
 * 不能作为称谓前缀的字（代词/指示词）。
 *
 * `他爷`、`你老爷`、`这姑娘` 这类是「代词 + 称谓」，不是专名。
 * 不排除的话它们频次很高，会挤掉真候选的名额（候选上限 200）。
 */
const PRONOUN_PREFIXES = new Set(["他", "她", "你", "我", "这", "那", "咱", "俺", "谁", "众", "每", "各"]);

/** 单个称谓候选的出现次数。 */
export interface AppellationCandidate {
  name     : string;
  frequency: number;
}

/**
 * 扫描全文，统计「X + 称谓后缀」的出现次数。
 *
 * @param text 全书正文
 * @param minFrequency 最低出现次数（默认 2；单次出现多半是分词或 OCR 噪声）
 * @returns 按频次降序的称谓候选
 */
export function scanAppellations(text: string, minFrequency = 2): AppellationCandidate[] {
  const counts = new Map<string, number>();

  for (const suffix of APPELLATION_SUFFIXES) {
    let from = 0;
    for (;;) {
      const index = text.indexOf(suffix, from);
      if (index < 0) break;
      from = index + 1;

      // 往前取 1..MAX_PREFIX_CHARS 个字，取最短的合法组合：
      // 「琏二奶奶」会先匹配到「二奶奶」（后缀表里有），再往前取到「琏」。
      for (let take = 1; take <= MAX_PREFIX_CHARS; take += 1) {
        const start = index - take;
        if (start < 0) break;
        const prefix = text.slice(start, index);
        if (!/^[\u4e00-\u9fa5]+$/u.test(prefix)) break;
        // 代词 + 称谓不是专名（「他爷」「你老爷」）。
        if (prefix.length === 1 && PRONOUN_PREFIXES.has(prefix)) break;
        const candidate = `${prefix}${suffix}`;
        counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
        // 只取最长的那个组合就够：更短的组合会被同一后缀的其他实例覆盖。
        break;
      }
    }
  }

  return [...counts.entries()]
    .filter(([, frequency]) => frequency >= minFrequency)
    .map(([name, frequency]) => ({ name, frequency }))
    .sort((left, right) => right.frequency - left.frequency);
}

/** 合并后的候选（两种来源统一成这个形状）。 */
export interface MergedCandidate {
  name        : string;
  frequency   : number;
  firstChapter: number;
}

/** 分词候选的最小形状（避免依赖管线模块的具体类型）。 */
export interface TokenizedCandidate {
  surface     : string;
  frequency   : number;
  firstChapter: number;
}

/**
 * 合并「分词候选」与「称谓候选」。
 *
 * 去重口径：**分词候选优先**。同一个写法若分词器已经切成整词，说明它在原文里
 * 是稳定的专名形态；称谓扫描只是补充，不该覆盖前者的频次与首现回目。
 *
 * 称谓候选的 `firstChapter` 在这里现算（扫一遍章节），因为扫描阶段只统计了
 * 全文频次，没有章节坐标 —— 而 L2 需要「首见第几回」来判断是不是主线人物。
 *
 * @param tokenized 分词候选
 * @param appellations 称谓候选
 * @param chapterTexts 章节正文（用于定位首现回目）
 * @returns 按频次降序的合并结果
 */
export function mergeCandidates(
  tokenized: readonly TokenizedCandidate[],
  appellations: readonly AppellationCandidate[],
  chapterTexts: readonly { ordinal: number; text: string }[]
): MergedCandidate[] {
  const merged = new Map<string, MergedCandidate>();

  for (const item of tokenized) {
    merged.set(item.surface, {
      name        : item.surface,
      frequency   : item.frequency,
      firstChapter: item.firstChapter
    });
  }

  for (const item of appellations) {
    if (merged.has(item.name)) continue;
    const chapter = chapterTexts.find((candidate) => candidate.text.includes(item.name));
    merged.set(item.name, {
      name        : item.name,
      frequency   : item.frequency,
      firstChapter: chapter?.ordinal ?? 0
    });
  }

  return [...merged.values()].sort((left, right) => right.frequency - left.frequency);
}
