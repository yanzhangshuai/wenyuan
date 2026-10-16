import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { externalKnowledge } from "@/server/db/schema";

export { hashSnapshot } from "./snapshot";

/**
 * `external_knowledge` 的读写（设计文档 §5.2）。
 *
 * 三条铁律的实现侧约束：
 * 1. **不写图谱表** —— 本模块只碰 `external_knowledge`；
 * 2. **不进评测口径** —— 评测脚本不得 import 本模块（审计脚本同样）；
 * 3. **UI 分区** —— 读侧把它与快照**并列**返回，不合并。
 */

export interface ExternalKnowledgeRecord {
  /** null = 跨作品通用。 */
  bookId      : string | null;
  subjectType : string;
  subjectKey  : string;
  field       : string;
  value       : string | null;
  resolution  : string;
  sourceUrls  : string[];
  snapshotHash: string | null;
  confidence  : string;
  fetchedAt   : Date;
}

/** 读取某作品的外部知识（含跨作品通用记录）。 */
export async function loadExternalKnowledge(bookId: string): Promise<ExternalKnowledgeRecord[]> {
  const db = getDatabase();
  const rows = await db
    .select()
    .from(externalKnowledge)
    .where(sql`${externalKnowledge.bookId} = ${bookId} or ${externalKnowledge.bookId} is null`);
  return rows.map((row) => ({
    bookId      : row.bookId,
    subjectType : row.subjectType,
    subjectKey  : row.subjectKey,
    field       : row.field,
    value       : row.value,
    resolution  : row.resolution,
    sourceUrls  : row.sourceUrls,
    snapshotHash: row.snapshotHash,
    confidence  : row.confidence,
    fetchedAt   : row.fetchedAt
  }));
}

/** 已存在的知识键集合（`subjectKey|field`）——**含 `unresolvable`**，用于幂等跳过。 */
export async function loadKnowledgeKeys(bookId: string): Promise<Set<string>> {
  const db = getDatabase();
  const rows = await db
    .select({ subjectKey: externalKnowledge.subjectKey, field: externalKnowledge.field })
    .from(externalKnowledge)
    .where(sql`${externalKnowledge.bookId} = ${bookId} or ${externalKnowledge.bookId} is null`);
  return new Set(rows.map((row) => `${row.subjectKey}|${row.field}`));
}

/**
 * 幂等写入（按唯一键 upsert）。
 *
 * 为什么手写 SQL 而不是 drizzle 的 `onConflictDoUpdate`：唯一索引建在
 * `coalesce(book_id, '0000…'::uuid)` 这个**表达式**上，drizzle 的冲突目标只接受列名。
 */
export async function upsertExternalKnowledge(records: readonly ExternalKnowledgeRecord[]): Promise<number> {
  if (records.length === 0) return 0;
  const db = getDatabase();
  let written = 0;
  for (const record of records) {
    // 唯一键建在 `coalesce(book_id, '0000…')` 表达式上，drizzle 的 onConflict 目标只接受列名；
    // 因此走「先删同键、再插入」——判定层是**离线单写者**，无需事务隔离。
    await db
      .delete(externalKnowledge)
      .where(
        and(
          record.bookId === null
            ? isNull(externalKnowledge.bookId)
            : eq(externalKnowledge.bookId, record.bookId),
          eq(externalKnowledge.subjectType, record.subjectType),
          eq(externalKnowledge.subjectKey, record.subjectKey),
          eq(externalKnowledge.field, record.field)
        )
      );
    await db.insert(externalKnowledge).values({
      bookId      : record.bookId,
      subjectType : record.subjectType,
      subjectKey  : record.subjectKey,
      field       : record.field,
      value       : record.value,
      resolution  : record.resolution,
      sourceUrls  : [...record.sourceUrls],
      snapshotHash: record.snapshotHash,
      confidence  : record.confidence,
      fetchedAt   : record.fetchedAt
    });
    written += 1;
  }
  return written;
}

/** 单作品知识条数（诊断用；不参与任何指标）。 */
export async function countExternalKnowledge(bookId: string): Promise<number> {
  const db = getDatabase();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(externalKnowledge)
    .where(eq(externalKnowledge.bookId, bookId));
  return rows[0]?.n ?? 0;
}
