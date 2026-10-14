import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { paragraphs, books } from "./books";
import { entityTypeEnum, nameTypeEnum } from "./enums";

/**
 * 实体域表：`entities` / `entity_aliases` / `entity_mentions`。
 *
 * 核心设计（修复 v1 的 mentions 丢失缺陷）：
 * - v1 靠 `name` 字符串精确匹配回填 `mentions`，归并后必然丢引用；
 * - v3 所有名字统一经 `normalizeName()` 处理，写入 `normalized_*` 列并建唯一索引；
 * - 归并只改 `entity_mentions.entity_id` 外键，**永不靠名字回填**。
 */

/** 实体（人物 / 地点 / 组织 / 概念）。 */
export const entities = pgTable(
  "entities",
  {
    id    : uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    canonical     : text("canonical").notNull(),
    /** `normalizeName(canonical)` 的结果，唯一约束的实际载体。 */
    normalizedName: text("normalized_name").notNull(),
    type          : entityTypeEnum("type").notNull(),
    nameType      : nameTypeEnum("name_type").notNull().default("NAMED"),
    /** 派系分组下标（对应主题 `factionColors[0..11]`）；未分组为 null。 */
    factionIndex  : integer("faction_index"),
    createdAt     : timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("entities_book_normname_uq").on(t.bookId, t.normalizedName),
    index("entities_book_type_idx").on(t.bookId, t.type)
  ]
);

/** 实体别名。 */
export const entityAliases = pgTable(
  "entity_aliases",
  {
    id    : uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    alias          : text("alias").notNull(),
    /** `normalizeName(alias)`；全作品唯一，防止一个别名指向两个实体。 */
    normalizedAlias: text("normalized_alias").notNull()
  },
  (t) => [
    uniqueIndex("entity_aliases_book_nornalias_uq").on(t.bookId, t.normalizedAlias),
    index("entity_aliases_entity_idx").on(t.entityId)
  ]
);

/** 实体提及（段落级出现记录，构成实体侧证据）。 */
export const entityMentions = pgTable(
  "entity_mentions",
  {
    id         : uuid("id").primaryKey().defaultRandom(),
    paragraphId: uuid("paragraph_id")
      .notNull()
      .references(() => paragraphs.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    /** 原文出现的字面形式。 */
    surface          : text("surface").notNull(),
    normalizedSurface: text("normalized_surface").notNull(),
    startOffset      : integer("start_offset").notNull(),
    endOffset        : integer("end_offset").notNull()
  },
  (t) => [
    index("entity_mentions_entity_idx").on(t.entityId),
    index("entity_mentions_paragraph_idx").on(t.paragraphId)
  ]
);
