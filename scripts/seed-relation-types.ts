import { seedRelationTypes } from "@/server/modules/seed/relation-types";

/**
 * 只同步关系类型字典（`pnpm seed:relation-types`）。
 *
 * 完整种子数据请用 `pnpm db:seed`（本脚本只是它的一个子集，便于单独重跑）。
 */
const result = await seedRelationTypes();
console.log(`[seed] relation_types 已同步 ${String(result.count)} 条`);
