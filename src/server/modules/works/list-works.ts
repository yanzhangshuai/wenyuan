import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { connection } from "next/server";
import { cache } from "react";

import { getDatabase } from "@/server/db/client";
import { entities, relationships, works } from "@/server/db/schema";

/**
 * 作品列表查询（服务端）。
 *
 * 设计原因：
 * - 实体数与关系数在 SQL 侧用子查询聚合，避免把全量行拉到 Node 里再统计；
 * - 用 `cache()` 包装，使首页与面包屑等复用同一请求内的查询结果；
 * - `await connection()` 是**必需**的：项目开启了 `cacheComponents`（PPR），
 *   Next 在构建期会尝试预渲染页面外壳；数据库读取不在 Next 可识别的动态 API 之列，
 *   不加这一句就会在构建期连库并失败。`connection()` 显式声明「此处需要真实请求」。
 */

/** 书库列表项。 */
export interface WorkListItem {
  id           : string;
  title        : string;
  author       : string | null;
  status       : "pending" | "parsing" | "ready" | "failed";
  chapterCount : number;
  entityCount  : number;
  relationCount: number;
  createdAt    : Date;
}

/**
 * 读取全部作品及其图谱规模。
 *
 * @returns 按创建时间倒序排列的作品列表
 */
export const listWorks = cache(async (): Promise<WorkListItem[]> => {
  // 显式声明运行时边界，阻止构建期预渲染执行数据库查询。
  await connection();

  const db = getDatabase();

  const entityCount = db
    .select({ count: sql<number>`count(*)::int` })
    .from(entities)
    .where(eq(entities.workId, works.id));

  const relationCount = db
    .select({ count: sql<number>`count(*)::int` })
    .from(relationships)
    .where(eq(relationships.workId, works.id));

  const rows = await db
    .select({
      id           : works.id,
      title        : works.title,
      author       : works.author,
      status       : works.status,
      chapterCount : works.chapterCount,
      createdAt    : works.createdAt,
      entityCount  : sql<number>`(${entityCount})`,
      relationCount: sql<number>`(${relationCount})`
    })
    .from(works)
    .orderBy(desc(works.createdAt));

  return rows;
});
