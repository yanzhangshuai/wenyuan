import "server-only";

import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { getDatabase } from "@/server/db/client";
import { analysisCalls, books, entities, relationships } from "@/server/db/schema";

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
  /**
   * 累计模型花费（美元，字符串保留精度）。
   *
   * 口径是 `analysis_calls` 的逐次调用累加 —— 与作品详情页「最近成本」同源，
   * 因此「所有作品成本之和」必然等于这个数（不会出现两套账）。
   */
  costUsd      : string;
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
 * @returns 作品 / 实体 / 关系 / 累计花费
 */
export async function loadOverviewStats(): Promise<OverviewStats> {
  const db = getDatabase();
  const [bookCount, entityCount, relationCount, costRows] = await Promise.all([
    countOf(books),
    countOf(entities),
    countOf(relationships),
    // 单表聚合，无 join，因此 `sql` 模板里插列引用不会踩「丢表限定」那个坑。
    db
      .select({ usd: sql<string | null>`round(sum(${analysisCalls.costUsd}), 4)::text` })
      .from(analysisCalls)
  ]);
  return {
    books        : bookCount,
    entities     : entityCount,
    relationships: relationCount,
    costUsd      : costRows[0]?.usd ?? "0"
  };
}
