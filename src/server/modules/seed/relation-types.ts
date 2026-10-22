import "server-only";

import { sql } from "drizzle-orm";

import { RELATION_TYPES } from "@/lib/relations";
import { getDatabase } from "@/server/db/client";
import { relationTypes } from "@/server/db/schema";

/**
 * 关系类型字典种子。
 *
 * 单一数据源是 `@/lib/relations` 的 `RELATION_TYPES` —— 该常量同时被提示词构建、
 * 输出校验与前端图例消费，因此字典不再单独维护一份 SQL。
 *
 * 幂等：以 `code` 为主键 upsert，可重复执行（生产环境每次发布跑都安全）。
 */

/** 同步结果。 */
export interface RelationTypesSeedResult {
  /** 写入/更新的条数。 */
  count: number;
}

/**
 * 同步关系类型字典。
 *
 * @returns 同步条数
 */
export async function seedRelationTypes(): Promise<RelationTypesSeedResult> {
  const db = getDatabase();
  const rows = RELATION_TYPES.map((item) => ({
    code     : item.code,
    label    : item.label,
    category : item.category,
    direction: item.direction
  }));

  await db
    .insert(relationTypes)
    .values(rows)
    .onConflictDoUpdate({
      target: relationTypes.code,
      set   : {
        label    : sql`excluded.label`,
        category : sql`excluded.category`,
        direction: sql`excluded.direction`
      }
    });

  return { count: rows.length };
}

/** 表存在性检查（用于「忘了先跑 migrate」的友好报错）。 */
export interface SchemaReadiness {
  relationTypes: boolean;
  users        : boolean;
}

/**
 * 检查种子依赖的表是否已建。
 *
 * @returns 各表是否存在
 */
export async function checkSchemaReadiness(): Promise<SchemaReadiness> {
  const db = getDatabase();
  const rows = await db.execute<{ relation_types: string | null; users: string | null }>(
    sql`select to_regclass('public.relation_types')::text as relation_types,
               to_regclass('public.users')::text as users`
  );
  const first = rows[0];
  return {
    relationTypes: first?.relation_types !== null && first?.relation_types !== undefined,
    users        : first?.users !== null && first?.users !== undefined
  };
}
