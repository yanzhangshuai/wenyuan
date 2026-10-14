/**
 * 滑动窗口分片（字数驱动）。
 *
 * 与 v1 的差异：v1 按「6 章一片」切分且**无重叠**，边界只落在章节处，
 * 导致跨章的对话/称谓证据被切断。v3 改为字数驱动 + 段落重叠：
 * - 片长目标 3000–4000 字，避免单片过长造成输出截断；
 * - 相邻片重叠 300–400 字（1–2 段），让跨边界的指代关系在两片中都可见；
 * - 重叠造成的重复关系由 pair 去重 + P4 投票消歧。
 *
 * 本模块是纯函数，不触碰数据库与网络，便于单测。
 */

/** 参与分片的段落（仅需序号与文本）。 */
export interface SliceParagraph {
  ordinal: number;
  text   : string;
}

/** 分片结果。 */
export interface TextSlice {
  /** 片在章内的序号，从 0 开始。 */
  index         : number;
  /** 首段序号（闭区间）。 */
  paragraphStart: number;
  /** 末段序号（闭区间）。 */
  paragraphEnd  : number;
  /** 拼接后的正文。 */
  text          : string;
  /** 正文字数。 */
  charCount     : number;
}

/** 分片参数。 */
export interface SliceOptions {
  /** 单片目标字数。 */
  targetChars? : number;
  /** 相邻片重叠字数。 */
  overlapChars?: number;
}

/** 默认单片目标字数：落在 3000–4000 区间中值，兼顾上下文完整与输出长度。 */
export const DEFAULT_TARGET_CHARS = 3500;

/** 默认重叠字数：约 1–2 段，足以覆盖跨段指代。 */
export const DEFAULT_OVERLAP_CHARS = 350;

/** 段落间的连接符：用换行保持段落边界可读，便于模型定位证据。 */
const PARAGRAPH_JOINER = "\n";

/**
 * 将一章的段落切成若干重叠分片。
 *
 * 不变量：
 * - 每片至少包含 1 段；
 * - 下一片起点严格大于当前片起点（保证循环终止）；
 * - 片内段落序号连续且不跨章。
 *
 * @param paragraphs 章节内段落（按 ordinal 升序）
 * @param options 分片参数
 * @returns 分片数组；输入为空时返回空数组
 */
export function sliceChapter(
  paragraphs: readonly SliceParagraph[],
  options: SliceOptions = {}
): TextSlice[] {
  const targetChars = options.targetChars ?? DEFAULT_TARGET_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  if (paragraphs.length === 0) {
    return [];
  }

  const slices: TextSlice[] = [];
  let start = 0;
  let index = 0;

  while (start < paragraphs.length) {
    let end = start;
    let charCount = 0;

    // 至少纳入一段，避免空片；之后累计到目标字数。
    while (end < paragraphs.length && (charCount < targetChars || end === start)) {
      charCount += paragraphs[end]?.text.length ?? 0;
      end += 1;
    }

    const lastIndex = end - 1;
    slices.push({
      index,
      paragraphStart: paragraphs[start]?.ordinal ?? 0,
      paragraphEnd  : paragraphs[lastIndex]?.ordinal ?? 0,
      text          : paragraphs
        .slice(start, end)
        .map((paragraph) => paragraph.text)
        .join(PARAGRAPH_JOINER),
      charCount
    });

    if (end >= paragraphs.length) {
      break;
    }

    // 从末段向前回退，收集约 overlapChars 字作为下一片的起始上下文。
    // 循环条件保证 overlapStart 至少推进到 start + 1，从而严格前进。
    let overlapStart = end;
    let overlapCount = 0;
    while (overlapStart > start + 1 && overlapCount < overlapChars) {
      overlapStart -= 1;
      overlapCount += paragraphs[overlapStart]?.text.length ?? 0;
    }

    start = overlapStart;
    index += 1;
  }

  return slices;
}
