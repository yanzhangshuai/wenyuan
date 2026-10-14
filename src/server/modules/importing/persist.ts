import { eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { chapters, paragraphs, works } from "@/server/db/schema";

import type { ParsedChapter } from "./parse-text";

/**
 * 导入结果的持久化（作品 / 章节 / 段落三张表）。
 *
 * 设计原因：
 * - 这三张表是**证据定位锚点**，一经写入即视为不可变。因此重复导入同一作品时
 *   采取「先删后建」而非「增量更新」—— 增量更新会让既有的
 *   `entity_mentions.paragraph_id` 指向错位的段落；
 * - 段落写入使用批量 insert，避免逐行往返导致的 N 次网络开销。
 */

/** 导入结果摘要。 */
export interface ImportedWorkSummary {
  workId           : string;
  title            : string;
  chapterCount     : number;
  paragraphCount   : number;
  totalChars       : number;
  /** 疑似章节切分失败的章节序号（单章超长）。 */
  oversizedChapters: number[];
}

/** 批量写入的分批大小，兼顾参数上限与内存。 */
const INSERT_BATCH_SIZE = 500;

/** 分批执行插入，返回受影响行数。 */
async function insertInBatches<T>(
  rows: readonly T[],
  insert: (batch: T[]) => Promise<unknown>
): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
    await insert(rows.slice(start, start + INSERT_BATCH_SIZE));
  }
}

/**
 * 持久化一部作品的解析结果。
 *
 * @param title 作品标题
 * @param author 作者（未知传 null）
 * @param parsedChapters 解析出的章节
 * @returns 导入摘要
 *
 * 幂等性：以 `title` 为口径先删除同名作品（级联删除章节与段落），再重新写入。
 */
export async function importWork(
  title: string,
  author: string | null,
  parsedChapters: readonly ParsedChapter[]
): Promise<ImportedWorkSummary> {
  const db = getDatabase();
  const totalChars = parsedChapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
  let workId = "";

  await db.transaction(async (tx) => {
    // 同名作品整体替换：段落坐标不可变，只能重建。
    await tx.delete(works).where(eq(works.title, title));

    const [work] = await tx
      .insert(works)
      .values({
        title,
        author,
        status      : "parsing",
        chapterCount: parsedChapters.length
      })
      .returning({ id: works.id });

    if (work === undefined) {
      throw new Error(`作品写入失败：${title}`);
    }
    workId = work.id;

    for (const chapter of parsedChapters) {
      const [insertedChapter] = await tx
        .insert(chapters)
        .values({
          workId   : work.id,
          ordinal  : chapter.ordinal,
          title    : chapter.title,
          rawText  : chapter.text,
          charCount: chapter.text.length
        })
        .returning({ id: chapters.id });

      if (insertedChapter === undefined) {
        // 用标题而非序号定位：前置内容的序号是 0（见 `parse-text.ts`），
        // 报成「第 0 章」会让人以为数据坏了。
        throw new Error(`章节写入失败：${title} 《${chapter.title}》`);
      }

      // 计算段落在章节正文中的字符偏移，供前端精确定位高亮。
      let offset = 0;
      const rows = chapter.paragraphs.map((paragraph) => {
        const startOffset = offset;
        offset += paragraph.text.length + 1; // +1 为还原段落间换行
        return {
          chapterId: insertedChapter.id,
          ordinal  : paragraph.ordinal,
          text     : paragraph.text,
          startOffset,
          endOffset: startOffset + paragraph.text.length
        };
      });

      await insertInBatches(rows, async (batch) => {
        await tx.insert(paragraphs).values(batch);
      });
    }

    await tx.update(works).set({ status: "ready" }).where(eq(works.id, work.id));
  });

  return {
    workId,
    title,
    chapterCount     : parsedChapters.length,
    paragraphCount   : parsedChapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0),
    totalChars,
    oversizedChapters: parsedChapters
      .filter((chapter) => chapter.text.length > 60_000)
      .map((chapter) => chapter.ordinal)
  };
}

/**
 * 按标题查找作品 ID。
 *
 * @param title 作品标题
 * @returns 作品 ID；不存在时返回 null
 */
export async function findWorkIdByTitle(title: string): Promise<string | null> {
  const db = getDatabase();
  const rows = await db
    .select({ id: works.id })
    .from(works)
    .where(eq(works.title, title))
    .limit(1);
  return rows[0]?.id ?? null;
}
