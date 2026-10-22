import "server-only";

import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { getDatabase } from "@/server/db/client";
import { books, entities, relationships } from "@/server/db/schema";

/**
 * 后台概览统计。
 *
 * 用途：登录页左栏的「真实数据」与后台仪表盘共用同一口径，
 * 避免出现「宣传 47 部、实际 2 部」这类不一致。
 */
export interface OverviewStats {
  /** 作品数。 */
  books        : number;
  /** 实体数（全部作品）。 */
  entities     : number;
  /** 关系数（全部作品，含已结束）。 */
  relationships: number;
}

/** 计数查询（用 `count(*)::int` 拿数字而非 bigint 字符串）。 */
async function countOf(table: PgTable): Promise<number> {
  const db = getDatabase();
  const rows = await db.select({ value: sql<number>`count(*)::int` }).from(table);
  return rows[0]?.value ?? 0;
}

/**
 * 读取概览统计。
 *
 * @returns 作品 / 实体 / 关系三项计数
 */
export async function loadOverviewStats(): Promise<OverviewStats> {
  const [bookCount, entityCount, relationCount] = await Promise.all([
    countOf(books),
    countOf(entities),
    countOf(relationships)
  ]);
  return { books: bookCount, entities: entityCount, relationships: relationCount };
}
