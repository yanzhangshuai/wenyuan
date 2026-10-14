/**
 * 版面标注（§3.4 的**阶段 ②**）：把**行级事实**从正文里抽出来 —— **只产事实，不做判断**。
 *
 * ## 为什么单独一个模块
 *
 * §3.4 把导入期分成两步，且**职责边界很硬**：
 *
 * | 阶段 | 做什么 | 不许做什么 |
 * |---|---|---|
 * | ① `canonicalize` | 改文本：编码 / 换行 / 空白 / **删整行噪声** | 不许做任何**判断** |
 * | ② `annotate`（本模块） | 产**事实**：每行的长度 / 是否句末收尾 / 是否块首 | 不许改文本、不许做判断 |
 * | ③ 解析器（`parse-text`） | 做**判断**：块内聚合 + 三条判据 | 不许再自己解析原文 |
 *
 * 分开的理由是 §3.5 第 2 条那条警告 —— **复杂度不会消失，只会搬家**：
 * 「这行是不是硬折行」这件事，放在清洗器里和放在解析器里是同一件事。
 * 所以本模块**故意不判断**，只把判据需要的输入**摆出来**，判断留给解析器。
 * 这样新增一本语料时，可以先看这份标注，判断是「判据不够」还是「这本书真特殊」——
 * 改的是**数据 / 规则**，不是**控制流**（与既有的「控制流 diff = 0」验收手法同源）。
 *
 * ## 为什么元数据可以降到**行级**（而不是块级）
 *
 * 2026-10-10 §3.17 体检实测（`_wb_annotate_probe.ts`，两本书逐章）：
 * 仅凭行级三个事实即可**逐条复现**解析器的全部段落输出（0 处不一致）；
 * 且清洗器**不必理解「块」** —— 块只是「连续的非块首行」。
 * 契约 = 每行三个事实：{@link AnnotatedLine.normalizedLength} /
 * {@link AnnotatedLine.isTerminated} / {@link AnnotatedLine.isBlockStart}。
 * ⚠️ 块内聚合（收尾率、median、longest）**留在解析器** —— 那是**判断**。
 *
 * ## 顺序要求
 *
 * ⚠️ 行级事实必须在**清洗之后**计算（§3.17 第八节）。判据是**贴着边界**的
 * （实测最紧的块距阈值只有 **0.003**），任何改动行内容或行序的清洗
 * （包括 §3.10b 的删行）都可能让判据翻面。生产路径天然满足这一点：
 * `stripStructuralNoise(normalizeEncoding(raw)).text` → `parseChapters` → 本模块。
 */

/** 段落收尾标点集合（判据 ① 用它，判据 ② 不用）。 */
export const PARAGRAPH_TERMINATOR = /[。！？”』]$/u;

/** 行内空白归一（含全角空格）—— 与 `canonicalize` 的口径一致。 */
const INLINE_SPACE = /[\s\u3000]+/g;

/**
 * 一行的版面事实 + 归一化后的文本。
 *
 * ⚠️ 这里**没有**「是否硬折行」「命中了哪条判据」这类字段 ——
 * 那些是**判断**，由解析器做（见文件头说明）。
 */
export interface AnnotatedLine {
  /**
   * 所属块的序号（从 0 起）。
   *
   * 仅供审计 / 打印用：**判定不依赖它** —— 解析器用
   * {@link AnnotatedLine.isBlockStart} 自己分组，这样「块」这个概念
   * 就不必进入清洗器。
   */
  blockIndex      : number;
  /** 归一化后的行文本：行内空白折叠为单个半角空格、两端已 `trim`。**非空**。 */
  text            : string;
  /** 归一化后的行长（= `text.length`）。 */
  normalizedLength: number;
  /** 行尾是否为句末标点（{@link PARAGRAPH_TERMINATOR}）。 */
  isTerminated    : boolean;
  /** 是否为块首（前一行是空行，或本行是文本的第一行）。 */
  isBlockStart    : boolean;
}

/**
 * 把正文逐行标注成「事实」。
 *
 * 规则（与 `splitParagraphs` 原先的内联实现**逐字等价**）：
 * 1. 按 `\n` 切行；
 * 2. 每行做 `replace(/[\s\u3000]+/g, " ").trim()` → 空的**丢弃**，且**让下一行成为块首**；
 * 3. 保留的行产出 `{ 文本, 长度, 是否收尾, 是否块首 }`。
 *
 * 等价性证据：搬迁前后对两本真实语料的**全量段落 dump** `cmp` 逐字节 0 差异
 * （`_wb_annotate_equiv.ts` → `_wb_annotate_before.out` / `_wb_annotate_after.out`）。
 *
 * @param text 章节正文（**应当是清洗之后的文本**，见文件头的顺序要求）
 * @returns 按原文顺序排列的行事实；全空文本返回空数组
 */
export function annotateLines(text: string): AnnotatedLine[] {
  const lines: AnnotatedLine[] = [];
  let blockIndex = -1;
  let isBlockStart = true;

  for (const raw of text.split("\n")) {
    const normalized = raw.replace(INLINE_SPACE, " ").trim();
    if (normalized.length === 0) {
      // 空行 = 块边界 → 下一行开新块。
      isBlockStart = true;
      continue;
    }

    if (isBlockStart) {
      blockIndex += 1;
    }

    lines.push({
      blockIndex,
      text            : normalized,
      normalizedLength: normalized.length,
      isTerminated    : PARAGRAPH_TERMINATOR.test(normalized),
      isBlockStart
    });

    isBlockStart = false;
  }

  return lines;
}
