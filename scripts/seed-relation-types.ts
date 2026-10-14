import { sql } from "drizzle-orm";

import { RELATION_TYPES } from "@/lib/relations";
import { getDatabase } from "@/server/db/client";
import { relationTypes } from "@/server/db/schema";

/**
 * 关系类型字典种子脚本。
 *
 * 单一数据源是 `src/lib/relations.ts` 的 `RELATION_TYPES` ——
 * 该常量同时被提示词构建、输出校验与前端图例消费，因此字典不再单独维护一份 SQL。
 *
 * 运行方式：`pnpm db:seed`（需先执行 `pnpm db:migrate`）
 * 幂等性：以 `code` 为主键 upsert，可重复执行。
 */
async function main(): Promise<void> {
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

  console.log(`[seed] relation_types 已同步 ${rows.length} 条`);
}

await main();
