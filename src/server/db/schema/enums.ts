import { pgEnum } from "drizzle-orm/pg-core";

import { AUTH_ROLES } from "@/lib/auth";
import { ENTITY_TYPES } from "@/lib/entities";

/**
 * 数据库枚举集中定义。
 *
 * 设计原因：
 * - 枚举值同时被 Drizzle schema、Zod 校验与前端类型消费，集中一处可避免三方漂移；
 * - 实体类型的取值来自 `@/lib/entities` 的单一数据源，不在此重复字面量；
 * - 字符串取值与 v1 金标 `scripts/goldset/schema.ts`、关系码目录
 *   `scripts/skills/classical-relationship-types.md` 严格一致，保证评测口径不变。
 */

/** 用户角色：取值来源见 `@/lib/auth`（前后端共用一份）。 */
export const appRoleEnum = pgEnum("app_role", AUTH_ROLES);

/** 作品解析状态。 */
export const bookStatusEnum = pgEnum("book_status", ["pending", "parsing", "ready", "failed"]);

/** 实体类型：取值来源见 `@/lib/entities`，与 v1 goldset 完全一致。 */
export const entityTypeEnum = pgEnum("entity_type", ENTITY_TYPES);

/** 名字类型：与 v1 goldset `NameTypeEnum` 完全一致。 */
export const nameTypeEnum = pgEnum("name_type", ["NAMED", "TITLE_ONLY"]);

/** 关系方向：与 v1 关系码目录 frontmatter 的 `direction` 完全一致。 */
export const relationDirectionEnum = pgEnum("relation_direction", ["SYMMETRIC", "INVERSE"]);

/** 关系生命周期状态：由 `aggregateRelationship()` 在 P6 阶段维护。 */
export const relationStatusEnum = pgEnum("relation_status", ["ACTIVE", "ENDED"]);

/** 解析运行状态。 */
export const analysisRunStatusEnum = pgEnum("analysis_run_status", [
  "running",
  "succeeded",
  "failed",
  "canceled"
]);

/**
 * 解析阶段标识，用于 `analysis_calls.stage` 归因与成本拆分。
 * 取值与实现方案第五节的 P0–P6 阶段一一对应。
 */
export const analysisStageEnum = pgEnum("analysis_stage", [
  "dictionary",
  "extract",
  "grounding",
  "review",
  "vote",
  "merge",
  "aggregate"
]);
