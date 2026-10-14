import { readFile } from "node:fs/promises";

import { normalizeEncoding, stripStructuralNoise } from "@/server/modules/importing/canonicalize";
import { FRONT_MATTER_ORDINAL, parseChapters } from "@/server/modules/importing/parse-text";

/**
 * 「按**生产口径**读一本书」—— 生成器类脚本的**唯一**语料入口。
 *
 * ## 为什么要单独抽出来（而不是各自 copy 一份）
 *
 * 生产导入走三步：`normalizeEncoding`（BOM/CRLF/零宽）→ `stripStructuralNoise`
 * （删整行噪声）→ `parseChapters`。生成器要产出的词典是**给生产用的**，
 * 就必须看**同一份**语料。
 *
 * ⚠️ 这条口径差**真的会咬人**：批 28 的侦察探针**只做了 `parseChapters`**，
 * 于是它报的绝对数（儒林 27479 / 红楼 53375 条 n-gram）是在**未剥离噪声行**
 * 的语料上取的 —— `stripStructuralNoise` 实测删掉儒林 114 行 / 红楼 120 行。
 * 曲线的**形状**不受影响，但**绝对数不可混用**（批 31 实测）。
 *
 * 如果 `generate-work-pack.ts` 与 `curate-work-pack.ts` 各写一份，
 * 就会重现同一类分歧 —— 而且更难发现（两份代码都「看起来对」）。
 * 所以这里只留一份实现，两个脚本都 import 它。
 *
 * ## 拼接口径
 *
 * 章间以 `\n` 连接、**丢弃前置内容**（`ordinal = 0`）。与批 28 探针一致，
 * 使「同一份语料」上的读数可比。
 */

/** 一本书的生产口径正文。 */
export interface BookBody {
  /** 各章正文以 `\n` 连接。 */
  readonly body        : string;
  /** 参与解析的章节数（**不含**前置内容）。 */
  readonly chapterCount: number;
  /** `stripStructuralNoise` 删掉的整行数。 */
  readonly deletedLines: number;
  /**
   * 各章**标题行**（`parseChapters` 把它们放在 `chapter.title`）。
   *
   * ⚠️ 它们**不在** `body` 里 —— 这正是批 32 发现「生成器看不见回目」的原因，
   * 也是批 34 的「回目通道」要补的那个洞。回目里全是**全名**
   * （「史太君寿终归地府」），是正文一律只用简称的那一类名字的**唯一**确定性来源。
   *
   * 顺序与 `body` 的章顺序一致（同样**不含**前置内容）。
   */
  readonly headings    : readonly string[];
}

/**
 * 读一本书，走生产口径的语料路径。
 *
 * @param absolutePath 书籍文本的绝对路径
 * @returns 正文 + 章节数 + 删行数 + 回目行
 */
export async function loadBookBody(absolutePath: string): Promise<BookBody> {
  const raw = await readFile(absolutePath, "utf8");
  const normalized = normalizeEncoding(raw);
  const { text, deletions } = stripStructuralNoise(normalized);
  const chapters = parseChapters(text).filter(
    (chapter) => chapter.ordinal !== FRONT_MATTER_ORDINAL
  );
  return {
    body        : chapters.map((chapter) => chapter.text).join("\n"),
    chapterCount: chapters.length,
    deletedLines: deletions.length,
    headings    : chapters.map((chapter) => chapter.title)
  };
}
