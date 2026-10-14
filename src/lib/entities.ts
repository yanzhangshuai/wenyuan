/**
 * 实体类型目录（闭集）。
 *
 * 定位：这是实体类型的**单一数据源**。以下三处必须全部引用本文件，不得各自硬编码字面量：
 * 1. 数据库枚举 `src/server/db/schema/enums.ts`（`entityTypeEnum`）
 * 2. 模型输出校验 `src/server/modules/analysis/schemas.ts`（`EntityTypeSchema`）
 * 3. 前端图谱视图模型 `src/types/graph.ts`
 *
 * 设计原因：v1 把枚举值散落在 goldset、数据库与前端三处，新增类型时必然漏改一处；
 * 集中定义后，`as const` 数组同时充当运行时取值列表与编译期联合类型来源。
 *
 * 约束：本文件不得引入数据库、React 或 Node 专属依赖，以便浏览器与服务端共用。
 */

/** 实体类型取值（顺序即 UI 中的展示顺序）。 */
export const ENTITY_TYPES = ["PERSON", "LOCATION", "ORGANIZATION", "CONCEPT"] as const;

/** 实体类型联合。 */
export type EntityType = (typeof ENTITY_TYPES)[number];

/** 实体类型的中文标签。 */
export const ENTITY_TYPE_LABELS: Readonly<Record<EntityType, string>> = {
  PERSON      : "人物",
  LOCATION    : "地点",
  ORGANIZATION: "组织",
  CONCEPT     : "概念"
};
