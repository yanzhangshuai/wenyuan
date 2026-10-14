/**
 * 纯文本小说解析：切分章节与段落（零 LLM 成本）。
 *
 * 设计原因：
 * - 章节切分质量直接决定证据定位的粒度。若把整本小说当一章，
 *   段落坐标会跨越全书，人工核对时无法定位；
 * - v1 依赖固定正则 `第[一二三…\d]+回`，对现代小说（`Chapter 1`、`第1章`）
 *   和散文式作品完全失效。v3 用**多模式**匹配，并保留「无章节标记时整本作一章」的兜底。
 *
 * 约束：本模块是纯函数，不触碰文件系统与数据库，便于对真实文本做单测。
 */
import { annotateLines, type AnnotatedLine } from "./annotate";
import { normalizeEncoding } from "./canonicalize";

/** 解析出的段落。 */
export interface ParsedParagraph {
  ordinal: number;
  text   : string;
}

/**
 * 前置内容（首个章节标题之前的引言 / 封面 / 版权页）的章节序号。
 *
 * 为什么是 0 而不是 1：`ordinal` 被下游当作**回号**使用 ——
 * 关系的 `start_chapter` 会被 UI 直接渲染成「第 N 章起」，
 * 评测的 `chapterRange` 也按它比对金标。
 *
 * 若让前置内容占用 1，整本书的章号会**整体偏移一位**。实测《儒林外史》
 * （导入含出版方导读「前言」）：`第三回` 的 `ordinal` 是 4，于是
 *   - UI 把第三回的边显示成「第 4 章起」；
 *   - 金标 `chapterRange: [1,3]`（意为第 1–3 回）实际取到的是
 *     「前言 + 第一回 + 第二回」，**整章漏掉第三回**（范进中举所在回），
 *     召回率因此被低估 18 个百分点。
 *
 * 用 0 表示「不属于任何一回」，既保留原文（不丢内容），又不污染回号。
 */
export const FRONT_MATTER_ORDINAL = 0;

/** 解析出的章节。 */
export interface ParsedChapter {
  /**
   * 章节序号。**真实章节从 1 起，等于回号**；
   * 前置内容为 {@link FRONT_MATTER_ORDINAL}（0）。
   */
  ordinal      : number;
  /** 是否为前置内容（由解析器合成，非来自真实标题行）。 */
  isFrontMatter: boolean;
  title        : string;
  text         : string;
  paragraphs   : ParsedParagraph[];
}

/** 单章正文长度上限，超过则按空行强制切分（防止一章被解析成整本书）。 */
const MAX_CHAPTER_CHARS = 60_000;

/**
 * 章节标题的识别模式（按优先级排列）。
 *
 * 覆盖：
 * - 中文古典：`第一回 宴桃园豪杰三结义`、`第三十六回`
 * - 中文现代：`第1章`、`第 12 章`、`第一章`
 * - 中文卷帙：`卷一`、`卷 3`
 * - 英文章节：`Chapter 1`、`CHAPTER XII`
 *
 * 约束：标题必须**独占一行**（允许前后空白），避免正文中的「第几回」被误判。
 *
 * 注意：不可使用 `\b` 作为分隔断言 —— 中文「回」与后续空格/汉字之间
 * 不构成 JS 正则的单词边界，会导致 `第一回 起` 这类标题匹配失败。
 * 因此改用「章节词 + 允许后缀」的显式结构。
 */
const CHAPTER_PATTERNS: readonly RegExp[] = [
  /^第\s*[0-9一二三四五六七八九十百千零〇两]+\s*[回章节篇]\s*.*$/,
  /^[卷篇]\s*[0-9一二三四五六七八九十百千零〇两]+\s*.*$/,
  /^chapter\s+[0-9ivxlcdm]+\s*.*$/i
];

/**
 * 标题前的语料噪声前缀。
 *
 * 真实语料（如《儒林外史》的 TXT 版本）会在每章标题前加出版方标记，
 * 形如 `　　正文 第一回　说楔子敷陈大义　借名流隐括全文` ——
 * 半角空格后的「正文」既非章节词也非标题正文。
 * 若不做剥离，`^第...` 永远匹配不上，**整本书会被解析成单章**。
 *
 * 只剥离**行首**的这类标记，且锚定行首，避免误伤正文中间的「正文」二字。
 */
const HEADING_NOISE_PREFIX = /^(?:正文|全文|正文卷|VIP|vip)\s*[:：]?\s*/;

/**
 * 标题里**不允许出现**的标点（中文句末 / 句中停顿符）。
 *
 * ## 为什么需要这条
 *
 * 「标题独占一行 + 40 字以内」两个条件**不足以**区分标题与正文 ——
 * 章回体小说的正文里天然会出现「第 N 回」的**回指**，且句子可能很短。
 * 实测《红楼梦》第五回开头（维基文库简体版）：
 *
 * ```
 * 第四回中既将薛家母子在荣府内寄居等事略已表明，此回则暂不能写矣。
 * ```
 *
 * 这一行 29 字、独占一行、以「第四回」开头 → 命中标题正则，
 * 于是**第五回被劈成两章**，此后全书回号**整体偏移一位**
 * （第六回变成 `ordinal = 7`）。这与历史上「前言占用了 ordinal 1」
 * 是同一类错误：**章节轴错位**，而 PRF 数字上看不出来。
 *
 * 判据是**标点**：回目是标题短语，不含句子停顿标点；
 * 而回指句必然带 `，`／`。`。两者在真实语料上完全可分。
 *
 * ## 为什么只收中文标点
 *
 * 英文章节标题（`Chapter 1, The Beginning`）里出现逗号是正常的，
 * 若把 ASCII 标点一并纳入，会误杀合法标题。故只收全角中文标点。
 *
 * ## 为什么**不**收 `：`
 *
 * `第一章：起` 这类写法真实存在，冒号在标题里是合法的分隔符。
 *
 * ## 为什么不用「回号必须递增」
 *
 * 那需要解析中文数字，且对「分卷后重新编号」的语料会误判；
 * 标点判据更便宜、更局部、失败模式更小。
 */
const TITLE_FORBIDDEN_PUNCTUATION = /[，。！？；]/;

/**
 * 剥离行首噪声前缀。
 *
 * @param trimmed 已 trim 的行
 * @returns 可送入标题正则的候选串
 */
function stripHeadingNoise(trimmed: string): string {
  return trimmed.replace(HEADING_NOISE_PREFIX, "");
}

/**
 * 判断某行是否为章节标题。
 *
 * @param line 单行文本（已去除首尾空白）
 * @returns 是标题时返回 true
 *
 * 三个条件必须同时满足：
 * 1. **独占一行**（本函数只接收单行，由调用方保证）；
 * 2. **长度 ≤ 40 字** —— 正文中偶然出现的「那第二回如何」这类句子通常更长；
 * 3. **不含中文句末／句中停顿标点** —— 见 {@link TITLE_FORBIDDEN_PUNCTUATION}。
 *    第 2 条单独用**不够**：实测《红楼梦》有一句 29 字的正文回指
 *    「第四回中既将薛家母子在荣府内寄居等事略已表明，此回则暂不能写矣。」
 *    同时满足前两条，会把第五回劈成两章、此后回号整体偏移一位。
 */
export function isChapterHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  // 长度判定用剥前缀后的串：否则长前缀会把合法标题挤过 40 字上限。
  const candidate = stripHeadingNoise(trimmed);
  if (candidate.length === 0 || candidate.length > 40) {
    return false;
  }
  if (TITLE_FORBIDDEN_PUNCTUATION.test(candidate)) {
    return false;
  }
  return CHAPTER_PATTERNS.some((pattern) => pattern.test(candidate));
}

/**
 * 「硬折行」的行长判据阈值。
 *
 * ## 为什么需要第二条判据
 *
 * 只看「行尾标点收尾率」会漏掉一整类语料。实测新语料《红楼梦》
 * （`books/红楼梦.txt`，120 回 / 86 万字）：
 *
 * - 该版本把**说话人与引语分成两行**：
 *   ```
 *   　　士隐因说道：
 *   　　“适闻仙师所谈因果，实人世罕闻者。”
 *   ```
 *   于是 `说道：` 这类行**不以句末标点收尾**，`：` 占了全部行的 19.6%；
 * - 诗社章节里「菊花诗」「怀古诗」等诗句行以 `，`／`；` 收尾；
 * - 结果 120 章里有 **15 章**收尾率低于 80% → 被 `lines.join(" ")`
 *   **整章并成 1 个段落**（第 5 章 7626 字 → 1 段）。
 *
 * 后果不是「难看」而是**下游失真**：`sliceChapter` 不硬切超长段落，
 * 于是一章变成一个 5000–9900 字的分片（目标 3000–4000），有输出截断风险；
 * 段落又是证据定位的最小单位，整章一段等于失去定位能力。
 *
 * ## 判据本身
 *
 * 硬折行（排版折行）会把**每个非末行**都填到折行宽度，
 * 于是「行长中位数 ≈ 行长最大值」—— 只有每段最后一行可能短。
 * 而「一行一段」的语料里段落长短悬殊，中位数远小于最大值。
 *
 * ```
 * 判据 ②（行长**重尾**）  ⟺  median <  longest × 0.5
 * 其反面（像硬折行）      ⟺  median >= longest × 0.5
 * ```
 *
 * ⚠️ 代码里**只保留与判据 ② 同极性的那个名字**（`hasHeavyTail`）。
 * 早期版本算的是它的**反面**（`looksHardWrapped`）再写 `!looksHardWrapped` ——
 * 语义没错，但读者扫到 `looksHardWrapped` 会以为它就是判据 ②，从而**把极性读反**
 * （2026-10-10 §3.17 实测：照变量名写的探针把「两判据冲突块」数出 **29**、真值 **36**，
 * 且探针自检全绿 —— 自检只验等价性、不验命名语义）。
 *
 * ## 为什么取 0.5（而不是更靠近 1 的值）
 *
 * 这个方向是**保守的**：只有当「连中位行都达到最长行的一半」时才认定是硬折行，
 * 才去折叠。误判的代价不对称 ——
 * 把「一行一段」错折叠成整章一段会**静默**毁掉定位；而少折叠只是多切了几段。
 *
 * ## 实测分离度（《红楼梦》120 章）
 *
 * 15 个曾被误折叠的章，其 `median / longest` 最高只有 **0.461**（第 105 章），
 * 其余均在 0.37 以下；真正的硬折行语料该比值接近 1.0。阈值 0.5 落在空隙里。
 *
 * ⚠️ **订正（2026-10-10 §3.20 实测）**：本节早先写着「把阈值换成 0.6／0.7／0.8，
 * 两个真实语料的段落数与分片数**完全相同** —— 说明结论不依赖这个具体取值」。
 * 该结论**只对《红楼梦》成立，对《儒林外史》为假**：儒林只有 `0.8 / 0.50` 这一个格子是
 * `1123 段 / 113 片 / 最大 5873 字 / 1 片单段超长`，其余 17 个组合
 * （② 阈值 ≥ 0.51，或 ① 阈值 ≤ 0.7）**全部**是 `1149 / 114 / 4470 / 0`。
 * 0.6 与 0.7 确实等价，**错的是「因此 0.8 也等价」这一步** —— 0.8 恰好跨在
 * 第四十五回那个块收尾率 0.714 的上方，差 0.086 就把整回从「拆」翻成「合」。
 * 🔑 **注释里的数值结论也会过期**：改动相关代码后必须重跑一次再引用。
 */
const WRAPPED_MEDIAN_RATIO = 0.5;

/**
 * 「折叠结果」的长度上限 —— 判据 ①／② 都未命中时的**兜底**。
 *
 * ## 为什么还需要第三条判据
 *
 * 判据 ① 与 ② 都是**贴着边界**的。实测（2026-10-10 §3.20）《儒林外史》第四十五回有一个块
 * 同时擦边未命中：收尾率 **0.714**（距 0.8 差 0.086）、`median / longest` = **0.508**
 * （距 0.5 只差 **0.008**）→ 走 `lines.join(" ")`，把**一整回正文折成 1 个段落**（**5873 字**）。
 *
 * 后果与判据 ② 那节描述的一样，只是这次连 ② 也救不回来：`sliceChapter` 不硬切超长段落，
 * 于是整回变成 1 个分片（目标 3500），而段落是**证据定位的最小单位** —— 整回一段等于失去定位能力。
 *
 * ## 为什么是「上限」而不是「调阈值」
 *
 * 调 ② 阈值（如 0.50 → 0.51）也能让这个块改判为「拆」，但那是**全局改判据**，
 * 会牵动**所有**贴边界的块（§3.17 实测红楼有 4 个块余量 < 0.02，最紧的只有 0.003）。
 * 本兜底的触发条件是**结果的性质**（折出来太长），不是**输入的边缘**（阈值差多少），
 * 因此它与语料排版无关，也不会因为文本轻微改动而翻面。
 *
 * ## 为什么取 2000
 *
 * 实测扫描（§3.20 Q6，`_wb_n5_probe.ts`）—— 它是**两值化**的，不是调参：
 * - `N ≥ 1500`：儒林稳定为 `1143 段 / 114 片 / 最大 4470 字 / 0 片单段超长`，
 *   且**只影响第四十五回**（其余 56 章逐字不变）；
 * - `N ≤ 1000`：会多动一个章（前言，1072 字、约 7 行）→ 不必要；
 * - 《红楼梦》：**所有 N 下逐字不变**（120/120 章）。
 *
 * 取 2000 是取「离两档边界足够远、又远小于任何正常回的长度」。
 */
const MAX_FOLDED_PARAGRAPH_CHARS = 2000;

/**
 * 判据 ① 的阈值：块内以句末标点收尾的行占比 ≥ 本值 → 判为「一行一段」。
 *
 * ⚠️ 这个数与 `WRAPPED_MEDIAN_RATIO` 一样是**判断参数**，属于解析器（不是清洗器）。
 */
const TERMINATED_LINE_RATIO = 0.8;

/**
 * 把章节正文切成段落。
 *
 * ## 输入不再是原文，而是**行级事实**
 *
 * 2026-10-10 §3③ 起，本函数**不再自己解析原文** —— 行级事实
 * （长度 / 是否收尾 / 是否块首）由 {@link annotateLines}（清洗器一侧）产出，
 * 这里只做**块内聚合与判断**。理由见 `annotate.ts` 的文件头：**复杂度只会搬家**，
 * 所以把「事实」与「判断」分到两个模块，判断留在解析器。
 *
 * 搬迁的等价性有硬证据：两本真实语料**全量段落 dump** 在搬迁前后 `cmp` 逐字节 0 差异
 * （`_wb_annotate_equiv.ts`）。
 *
 * ## 判断规则
 *
 * 先用 `isBlockStart` 把行分回「块」（空行之间的连续行），再**满足任一**即判「一行一段」：
 * 1. **块内各行普遍以句末标点收尾**（`。！？”』`）——
 *    「一行一段」的语料每行是一个完整句子，行尾必有标点；
 *    「硬折行」的语料行尾通常没有，只有该段最后一行才有；
 * 2. **行长重尾**（`median < longest × 0.5`）—— 见 {@link WRAPPED_MEDIAN_RATIO}。
 *    第 1 条单独用**不够**：实测《红楼梦》有 15 章因「说话人与引语分行」而使收尾率跌破 80%。
 * 3. **兜底：折叠结果超长**（`lines.join(" ").length > 2000`）——
 *    见 {@link MAX_FOLDED_PARAGRAPH_CHARS}。第 1、2 条都是**贴边界**的，
 *    实测《儒林外史》第四十五回有一个块两条都差一点未命中（0.086 / 0.008），
 *    于是整回 5873 字被折成 1 段。
 *
 * 不采用「行长是否均匀」作为判据 —— 实测表明短段落天然长度接近
 * （如 `甲段。`/`乙段。`），会把合法的一行一段语料误判为硬折行。
 * 第 2 条用的是**相反**的方向（重尾而非均匀），因此不受这个反例影响。
 * 第 3 条则是与排版无关的**长度兜底**，只在「折出来明显不像一个段落」时才介入。
 *
 * @param text 章节正文
 * @returns 段落列表；空正文返回空数组
 */
export function splitParagraphs(text: string): ParsedParagraph[] {
  return paragraphsFromAnnotatedLines(annotateLines(text));
}

/**
 * **仅凭行级事实**重建段落序列。
 *
 * 单独导出是为了让它可被直接检验：可以喂进**构造的**事实（而原文不变），
 * 从而证明「判定确实由事实驱动，而不是偷偷再读一遍原文」
 * （见 `parse-text.test.ts` 里的「事实承重」护栏）。
 *
 * @param lines 行级事实（顺序 = 原文顺序）
 * @returns 段落列表
 */
export function paragraphsFromAnnotatedLines(
  lines: readonly AnnotatedLine[]
): ParsedParagraph[] {
  const paragraphs: string[] = [];

  let index = 0;
  while (index < lines.length) {
    const start = index;
    index += 1;
    // 块 = 连续的「非块首」行；下一个块首即边界。
    while (index < lines.length && lines[index]?.isBlockStart !== true) {
      index += 1;
    }
    const block = lines.slice(start, index);
    const texts = block.map((line) => line.text);
    const folded = texts.join(" ");

    // 判据 1：「一行一段」判定 —— 绝大多数行以句末标点收尾。
    const terminated = block.filter((line) => line.isTerminated).length;

    // 判据 2：行长**重尾**（`median < longest × 0.5`）—— 变量名与判据 ② **同极性**，
    // 不再算反面再取反（见上方注释里那条 2026-10-10 §3.17 的实测）。
    const lengths = block
      .map((line) => line.normalizedLength)
      .sort((left, right) => left - right);
    const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
    const longest = lengths[lengths.length - 1] ?? 0;
    const hasHeavyTail = median < longest * WRAPPED_MEDIAN_RATIO;

    // 判据 3（兜底）：折叠结果本身超长 —— 见 MAX_FOLDED_PARAGRAPH_CHARS 的注释。
    // 它与语料排版无关，只回答「折出来像不像一个段落」。
    const tooLongToFold = folded.length > MAX_FOLDED_PARAGRAPH_CHARS;

    if (terminated / block.length >= TERMINATED_LINE_RATIO || hasHeavyTail || tooLongToFold) {
      paragraphs.push(...texts);
    } else {
      paragraphs.push(folded);
    }
  }

  return paragraphs.map((text, position) => ({ ordinal: position + 1, text }));
}

/**
 * 解析纯文本小说为章节结构。
 *
 * ## 编码归一化的位置
 *
 * 这里调用 {@link normalizeEncoding} 是**防御性兜底**，不是唯一入口 ——
 * 导入路径（`scripts/import-book.ts`）会在读文件之后**显式**先调一次。
 * 保留这一层是因为 `parseChapters` 也被单测与探针直接调用，
 * 它们传进来的是原始文本（含 CRLF）。两处调用是幂等的，顺序无关。
 *
 * @param raw 原始文本（UTF-8 解码后的内容）
 * @returns 章节列表；未识别到任何标题时返回单章（`title` 为「正文」）
 */
export function parseChapters(raw: string): ParsedChapter[] {
  const normalized = normalizeEncoding(raw);
  const lines = normalized.split("\n");

  /** 累积中的章节。 */
  interface Draft {
    title      : string;
    lines      : string[];
    /** 是否由解析器**合成**（首个标题之前的引言 / 整本兜底），而非来自真实标题行。 */
    synthesized: boolean;
  }

  const drafts: Draft[] = [];

  /** 新建一个草稿章节并返回它；返回值非空，消除调用方的空值判断。 */
  function openDraft(title: string, synthesized: boolean): Draft {
    const draft: Draft = { title, lines: [], synthesized };
    drafts.push(draft);
    return draft;
  }

  let current: Draft | null = null;

  for (const line of lines) {
    if (isChapterHeading(line)) {
      // 标题存剥离噪声后的形式，避免「正文 第一回 …」这类前缀污染章节名。
      current = openDraft(stripHeadingNoise(line.trim()), false);
      continue;
    }

    // 首个标题之前的引言 / 封面文字：作为前言章节保留，避免内容丢失。
    current ??= openDraft("前言", true);
    current.lines.push(line);
  }

  const nonEmpty = drafts.filter((draft) => draft.lines.join("").trim().length > 0);
  const source = nonEmpty.length === 0 ? [{ title: "正文", lines, synthesized: false }] : nonEmpty;

  // **只有确实切出了真实章节时**，合成的那一段才算「前置内容」。
  // 否则（全书无标题标记，整本塌成一段）它就是**整本正文**，
  // 必须拿到正常序号 —— 给它 0 会被下游当成前置内容而整本跳过。
  const hasRealChapter = source.some((draft) => !draft.synthesized);

  let ordinal = 0;
  return source.map((draft) => {
    const text = draft.lines.join("\n").trim();
    const isFrontMatter = draft.synthesized && hasRealChapter;
    if (!isFrontMatter) {
      ordinal += 1;
    }
    return {
      ordinal   : isFrontMatter ? FRONT_MATTER_ORDINAL : ordinal,
      isFrontMatter,
      title     : draft.title,
      text,
      paragraphs: splitParagraphs(text)
    };
  });
}

/**
 * 判断解析结果是否「疑似单章吞全书」。
 *
 * 用途：导入脚本据此在 `analysis_issues` 里留档提醒 ——
 * 单章超过阈值通常意味着章节正则没匹配上，需要人工确认。
 *
 * @param chapters 解析结果
 * @returns 存在超大章节时为 true
 */
export function hasOversizedChapter(chapters: readonly ParsedChapter[]): boolean {
  return chapters.some((chapter) => chapter.text.length > MAX_CHAPTER_CHARS);
}
