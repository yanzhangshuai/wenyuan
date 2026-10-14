import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

import { entities } from "./entities";
import { relationDirectionEnum, relationStatusEnum } from "./enums";
import { paragraphs, works } from "./works";

/**
 * 关系域表：`relation_types` / `relationships` / `evidence_spans`。
 *
 * 关键设计：
 * - `relationships` 即**邻接表**，配合 `(work_id, source_entity_id)` 与
 *   `(work_id, target_entity_id)` 两个索引支撑递归 CTE 路径查询（无需 Neo4j）；
 * - 关系带有效期 `start_chapter` / `end_chapter`（未结束为 null），
 *   由 P6 的 `aggregateRelationship()` 维护 INSERT / EXTEND / CLOSE 语义。
 */

/** 关系类型字典（闭集，种子数据来自 v1 `classical-relationship-types` skill）。 */
export const relationTypes = pgTable("relation_types", {
  code     : varchar("code", { length: 32 }).primaryKey(),
  label    : text("label").notNull(),
  /**
   * 语义分组下标 0..4，与主题 `edgeTypeColors` 顺序一一对应：
   * 0 亲属 / 1 友好 / 2 对立 / 3 从属 / 4 其他（兜底）。
   */
  category : integer("category").notNull(),
  direction: relationDirectionEnum("direction").notNull()
});

/** 关系（邻接表）。 */
export const relationships = pgTable(
  "relationships",
  {
    id    : uuid("id").primaryKey().defaultRandom(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    sourceEntityId: uuid("source_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    targetEntityId: uuid("target_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    relationTypeCode: varchar("relation_type_code", { length: 32 })
      .notNull()
      .references(() => relationTypes.code),
    /** 关系生效章节（首次观察到的章节序号）。 */
    startChapter: integer("start_chapter").notNull(),
    /** 关系终止章节；null 表示到全书结束仍成立。 */
    endChapter  : integer("end_chapter"),
    status      : relationStatusEnum("status").notNull().default("ACTIVE"),
    createdAt   : timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    // 同一作品内，同一 (源, 目标, 类型) 只允许一条记录，有效期通过章节字段扩展。
    uniqueIndex("relationships_triple_uq").on(
      t.workId,
      t.sourceEntityId,
      t.targetEntityId,
      t.relationTypeCode
    ),
    // 双向索引：无向遍历时以 UNION 合并两个方向。
    index("relationships_source_idx").on(t.workId, t.sourceEntityId),
    index("relationships_target_idx").on(t.workId, t.targetEntityId)
  ]
);

/** 关系证据片段（段落内字面引用）。 */
export const evidenceSpans = pgTable(
  "evidence_spans",
  {
    id            : uuid("id").primaryKey().defaultRandom(),
    /** 关系证据；实体提及证据直接落在 `entity_mentions` 上，此处为 null。 */
    relationshipId: uuid("relationship_id").references(() => relationships.id, {
      onDelete: "cascade"
    }),
    paragraphId: uuid("paragraph_id")
      .notNull()
      .references(() => paragraphs.id, { onDelete: "cascade" }),
    startOffset: integer("start_offset").notNull(),
    endOffset  : integer("end_offset").notNull(),
    /** 原文引用文本，用于人工核对与前端高亮。 */
    quote      : text("quote").notNull()
  },
  (t) => [index("evidence_spans_relationship_idx").on(t.relationshipId)]
);
