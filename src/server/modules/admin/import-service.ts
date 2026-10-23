import { normalizeEncoding, stripStructuralNoise } from "@/server/modules/importing/canonicalize";
import { parseChapters } from "@/server/modules/importing/parse-text";
import { importBook } from "@/server/modules/importing/persist";

/**
 * 导入文本（解析前的「建作品」步骤）。
 *
 * 边界：
 * - 本函数**只负责建作品**，不触发解析；「导入即解析」由调用方（`POST /api/admin/import`）
 *   在导入成功后调用 `enqueueAnalysis()` 完成 —— 这样 CLI 导入（`pnpm import:book`）
 *   仍然可以只入库、不花钱；
 * - 清洗顺序不可交换：先归编码（BOM/CRLF/零宽字符），再删整行噪声，最后切章；
 * - 同名作品会被**整体替换**（段落坐标不可变，只能重建），因此响应里回传被替换的标题，
 *   前端必须显式提示这一点。
 */

/** 单文件上限（字节）：20 MB，足以覆盖 2.6 MB 的红楼梦并留出余量。 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** 导入结果。 */
export interface ImportResult {
  bookId        : string;
  title         : string;
  chapterCount  : number;
  paragraphCount: number;
  totalChars    : number;
  /** 结构性噪声删除行数（便于对回原文坐标）。 */
  deletedLines  : number;
}

/**
 * 执行导入。
 *
 * @param title 作品标题（非空）
 * @param author 作者（可空）
 * @param rawText 原始文本
 * @returns 导入摘要
 */
export async function importBookFromText(
  title: string,
  author: string | null,
  rawText: string
): Promise<ImportResult> {
  const normalized = normalizeEncoding(rawText);
  const { text, deletions } = stripStructuralNoise(normalized);
  const parsedChapters = parseChapters(text);

  if (parsedChapters.length === 0) {
    throw new Error("未能从文本中解析出任何章节内容");
  }

  const summary = await importBook(title, author, parsedChapters);
  return {
    bookId        : summary.bookId,
    title         : summary.title,
    chapterCount  : summary.chapterCount,
    paragraphCount: summary.paragraphCount,
    totalChars    : summary.totalChars,
    deletedLines  : deletions.length
  };
}

/** 文件大小上限（供路由层做前置校验）。 */
export { MAX_FILE_BYTES };
