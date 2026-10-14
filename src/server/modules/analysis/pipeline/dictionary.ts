import { normalizeName } from "@/lib/text";

import { DEFAULT_GENRE_PACK, type GenrePack } from "../genre-pack";

/**
 * P0 词典预扫描：全书候选名的**确定性**抽取与频次统计（零 LLM 成本）。
 *
 * 目的（对应 v1 缺陷一「token 消耗大」）：
 * - v1 把整本书的每片正文都塞进提示词，模型每片都要从零识别同一批人物，
 *   既浪费 token 又导致同一人物在不同片被写成不同名字；
 * - v3 先用纯字符串工序扫出「高频专名」清单，作为**词典锚点**注入后续提示词。
 *   模型只需做「从给定清单中挑选 + 补充遗漏」，输出更短、更稳、更省。
 *
 * 本模块只做统计与筛选，不做语义判定 —— 是否为真实体交给 P0 的模型分类环节。
 */

/** 单个候选名的统计信息。 */
export interface CandidateName {
  /** 原文中出现的代表性写法（取首次出现的形态）。 */
  surface     : string;
  /** 归一化键（`normalizeName`）。 */
  normalized  : string;
  /** 全书出现次数。 */
  frequency   : number;
  /** 首次出现的章节序号（从 1 开始）。 */
  firstChapter: number;
}

/** 预扫描参数。 */
export interface ScanOptions {
  /** 最低出现次数阈值。默认 3 —— 单次出现的专名多为一次性配角或分词噪声。 */
  minFrequency? : number;
  /** 候选名长度上限（归一化后字符数）。默认 6，覆盖「欧阳修」到「司马光」等中外人名尺度。 */
  maxNameLength?: number;
  /** 返回的候选名数量上限。默认 200，控制提示词体积。 */
  limit?        : number;
  /** 题材包；省略时用默认包（古典白话中文）。换题材时由调用方传入。 */
  genrePack?    : GenrePack;
}

/**
 * 默认最低频次 / 名字长度上限 / 候选名数量上限。
 *
 * ⚠️ 取值来源已改为**题材包**（`genre-pack/classical/lexicon.ts`）——
 * 这三项都是「一层文体」的预算约束，换题材时应当可调。
 * 保留同名导出只是为了让既有调用方不必改动（搬迁为零行为变更）。
 */
export const DEFAULT_MIN_FREQUENCY = DEFAULT_GENRE_PACK.lexicon.minCandidateFrequency;

/** 默认名字长度上限。 */
export const DEFAULT_MAX_NAME_LENGTH = DEFAULT_GENRE_PACK.lexicon.maxCandidateNameLength;

/** 默认候选名数量上限。 */
export const DEFAULT_CANDIDATE_LIMIT = DEFAULT_GENRE_PACK.lexicon.candidateLimit;

/**
 * `segmentit` 词性码（与 `POSTAG` 常量对齐的数值子集）。
 *
 * 背景：`segmentit` 的默认词典是**现代汉语**词典，对古典小说（如《儒林外史》）
 * 的专名切分极不可靠 —— 实测「杜少卿」被切成「杜少/卿道」、
 * 「马纯上」被切成「马纯/上」、「牛布衣」被切成「牛/布衣」。
 *
 * 因此**不能只靠「长度 2~6 且含汉字」放行**（这正是 v3 初版的做法，
 * 导致「先生」(889)、「老爷」(625)、「银子」(535) 这类高频泛称挤占清单，
 * 而真实人物被截断后落选）。词性码是分词库唯一可靠的语义信号，
 * 必须用于**准入**判定。
 *
 * 数值取自 `segmentit.POSTAG`，此处以常量固化以隔离对库版本的依赖。
 */
const POSTAG_CODE = {
  /** 人名。 */
  PERSON      : 128,
  /** 地名。 */
  PLACE       : 64,
  /** 机构/团体名。 */
  ORGANIZATION: 32,
  /** 其他专名。 */
  OTHER_PROPER: 16
} as const;

/**
 * 允许进入候选清单的词性码集合。
 *
 * 只收专名类（人/地/机构/其他专名）：
 * - 这些是关系图谱里「实体」的天然载体；
 * - 泛称（`A_N`=1048576，如「先生」「银子」）与动词（`D_V`=4096）
 *   一律排除，避免噪声挤占有限的名额。
 *
 * 例外：**词性未知（`UNK`=0）或空串**时**放行**。
 * 原因：古典文本里大量专名会退化为无标注词（实测「严监生」即无词性码），
 * 若一刀切排除会漏召回真名。此处用「长度 + 停用表」兜底过滤，
 * 把精度问题留给后续 P0 的模型判定环节 —— 那才是语义决策的正确位置。
 */
const ALLOWED_POSTAG_CODES: ReadonlySet<string> = new Set([
  String(POSTAG_CODE.PERSON),
  String(POSTAG_CODE.PLACE),
  String(POSTAG_CODE.ORGANIZATION),
  String(POSTAG_CODE.OTHER_PROPER)
]);

/**
 * 判断词性码是否允许进入候选清单。
 *
 * @param tag 词性码字符串（`segmentChapter` 输出；未标注时为 `""`）
 * @returns 允许时为 true
 */
export function isAllowedPostag(tag: string): boolean {
  // 无词性标注：放行，交由长度与停用表兜底（见 ALLOWED_POSTAG_CODES 注释）。
  if (tag === "") {
    return true;
  }
  // 非纯数字（如测试里的 "n"）：不视为有效词性码，放行以免误杀。
  if (!/^\d+$/.test(tag)) {
    return true;
  }
  // 纯数字词性码：必须是专名类才放行。
  return ALLOWED_POSTAG_CODES.has(tag);
}

/**
 * 判断归一化后的字面是否为**无区分度的泛称**。
 *
 * 用途：别名与规范名共用同一张表 —— 别名若命中此处即说明它无法指代特定个人
 * （「老爹」「少爷」可以指任何人），既不能作为实体，也不能作为合并依据。
 *
 * ⚠️ 表本身已搬进题材包（`genre-pack/classical/lexicon.ts` 的 `STOP_WORDS`）。
 * 搬迁是**逐字**的，行为零变更；匹配语义仍是**精确相等**（`Set.has`）而非子串 ——
 * 这是整张表的安全边界：只砍**光杆泛称**，带前缀的具体称呼一律放行
 * （`夫人` 在表内，`王夫人` 不受影响）。
 *
 * @param normalized 归一化后的字面
 * @param genrePack 题材包；省略时用默认包
 * @returns 命中泛称表时为 true
 */
export function isStopWord(
  normalized: string,
  genrePack: GenrePack = DEFAULT_GENRE_PACK
): boolean {
  return genrePack.lexicon.stopWords.has(normalized);
}

/**
 * 字面被拒的原因。
 *
 * 为什么要单独把「原因」抽出来（而不是只返回布尔）：
 * 本模块（P0 候选扫描）与 `entity-gate.ts`（P1 输出准入）需要**同一套**判定口径，
 * 但两者的用途不同 —— P0 只需知道「能不能当锚点」，P1 需要把拒绝原因
 * 写进 `analysis_issues` 供事后归因（「这个实体为什么没进图谱」）。
 * 共用同一个函数可避免两张停用表各自漂移。
 */
export type CandidateRejectionReason = "single_char" | "too_long" | "stop_word" | "no_cjk";

/**
 * 判断归一化后的字面被拒的原因。
 *
 * 排除规则：
 * - 长度为 1（单字名在中文里多为姓氏或指代，歧义过大）；
 * - 超过长度上限（通常是分词把整句粘成了一个词）；
 * - 命中停用表；
 * - 全部由非表意字符（标点、数字、ASCII 符号）构成。
 *
 * @param normalized 归一化后的字面
 * @param maxNameLength 长度上限
 * @param genrePack 题材包（提供停用表）；省略时用默认包
 * @returns 拒绝原因；通过时返回 null
 */
export function rejectCandidateReason(
  normalized: string,
  maxNameLength: number,
  genrePack: GenrePack = DEFAULT_GENRE_PACK
): CandidateRejectionReason | null {
  if (normalized.length < 2) {
    return "single_char";
  }
  if (normalized.length > maxNameLength) {
    return "too_long";
  }
  if (genrePack.lexicon.stopWords.has(normalized)) {
    return "stop_word";
  }
  // 至少含一个 CJK 统一表意文字，排除纯标点/数字/西文碎片。
  if (!/[\u4e00-\u9fff]/.test(normalized)) {
    return "no_cjk";
  }
  return null;
}

/**
 * 判断归一化后的字面是否值得作为候选名。
 *
 * @param normalized 归一化后的字面
 * @param maxNameLength 长度上限
 * @param genrePack 题材包（提供停用表）；省略时用默认包
 * @returns 可用作候选名时为 true
 */
export function isViableCandidate(
  normalized: string,
  maxNameLength: number,
  genrePack: GenrePack = DEFAULT_GENRE_PACK
): boolean {
  return rejectCandidateReason(normalized, maxNameLength, genrePack) === null;
}

/**
 * 从分词结果中抽取候选名并统计频次。
 *
 * 定位：这是预扫描的**纯逻辑核心**，与具体分词库解耦 ——
 * 分词库（`segmentit`）只负责提供「词 + 词性」序列，本函数负责选词与计数。
 * 这样可以脱离 `segmentit` 的词典版本做稳定单测。
 *
 * @param tokens 逐章的分词结果（`chapterOrdinal` 从 1 开始）
 * @param options 参数
 * @returns 按频次降序排列的候选名列表；频次相同按首次出现章节升序
 */
export function collectCandidateNames(
  tokens: readonly { chapterOrdinal: number; words: readonly { word: string; tag: string }[] }[],
  options: ScanOptions = {}
): CandidateName[] {
  const genrePack = options.genrePack ?? DEFAULT_GENRE_PACK;
  const minFrequency = options.minFrequency ?? genrePack.lexicon.minCandidateFrequency;
  const maxNameLength = options.maxNameLength ?? genrePack.lexicon.maxCandidateNameLength;
  const limit = options.limit ?? genrePack.lexicon.candidateLimit;

  const stats = new Map<string, CandidateName>();

  for (const chapter of tokens) {
    for (const token of chapter.words) {
      // 词性准入：过滤泛称与动词噪声（见 ALLOWED_POSTAG_CODES 注释）。
      if (!isAllowedPostag(token.tag)) {
        continue;
      }

      const normalized = normalizeName(token.word);
      if (!isViableCandidate(normalized, maxNameLength, genrePack)) {
        continue;
      }

      const existing = stats.get(normalized);
      if (existing === undefined) {
        stats.set(normalized, {
          surface     : token.word,
          normalized,
          frequency   : 1,
          firstChapter: chapter.chapterOrdinal
        });
        continue;
      }
      existing.frequency += 1;
    }
  }

  return [...stats.values()]
    .filter((candidate) => candidate.frequency >= minFrequency)
    .sort((left, right) => {
      if (right.frequency !== left.frequency) {
        return right.frequency - left.frequency;
      }
      if (left.firstChapter !== right.firstChapter) {
        return left.firstChapter - right.firstChapter;
      }
      return left.normalized.localeCompare(right.normalized);
    })
    .slice(0, limit);
}

/**
 * 把候选名清单渲染成提示词片段。
 *
 * @param candidates 候选名列表
 * @returns 每行一个「写法(次数)」的文本；空清单返回空串
 *
 * 设计原因：附上频次可让模型优先处理主线人物，避免在一次性配角上过度展开。
 */
export function renderCandidateDictionary(candidates: readonly CandidateName[]): string {
  return candidates
    .map((candidate) => `${candidate.surface}(${candidate.frequency})`)
    .join("\n");
}
