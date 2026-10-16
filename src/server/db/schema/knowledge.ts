import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { books } from "./books";

/**
 * 外部知识表（三期「判定层」的唯一落库位置）。
 *
 * 设计文档：`docs/plans/2026-10-16-不确定性建模-design.md` §5.2。
 *
 * ## 三条铁律（写在最前，因为这是全项目唯一允许写外部数据的表）
 * 1. **不写图谱表** —— `entities` / `relationships` 一个字节都不动；
 * 2. **不进评测口径** —— 金标、变异锚点、审计脚本都不引用本表；
 * 3. **UI 分区** —— 「本书信息」与「外部资料」视觉分开。
 *
 * ## 为什么判定要落库（而检测不落库）
 * 检测是图谱的确定性派生（读时算即可）；判定**有成本、需缓存、需可复核**：
 * - 有成本：检索 + 结构化各一次调用 → 不落库则每次重跑都重付；
 * - 需缓存：包括**「查过了，查不到」**（`resolution = 'unresolvable'`）——
 *   否则每次重跑都要重查一遍注定查不到的实体；
 * - 需可复核：`source_urls` + `snapshot_hash` 让「这条外部知识从哪来」可追溯
 *   （外部资料擅长**证伪**，不擅长证真 —— 见设计文档 §5.4）。
 */
export const externalKnowledge = pgTable(
  "external_knowledge",
  {
    id          : uuid("id").primaryKey().defaultRandom(),
    /** null = 跨作品通用（如历史人物的本名）。 */
    bookId      : uuid("book_id").references(() => books.id, { onDelete: "cascade" }),
    /** `entity` | `relationship`。 */
    subjectType : text("subject_type").notNull(),
    /** 规范名 / 端点对。 */
    subjectKey  : text("subject_key").notNull(),
    /** `canonical_name` | `biography` | `hometown` | `courtesy_name` | `prototype` | `relation_note`。 */
    field       : text("field").notNull(),
    value       : text("value"),
    /** `resolved` | `disputed` | `unresolvable`。 */
    resolution  : text("resolution").notNull(),
    sourceUrls  : text("source_urls").array().notNull().default(sql`'{}'`),
    /** 抓取内容的哈希：同 URL 内容变化可被察觉。 */
    snapshotHash: text("snapshot_hash"),
    /** `high` | `medium` | `low` | `none`。 */
    confidence  : text("confidence").notNull(),
    fetchedAt   : timestamp("fetched_at", { withTimezone: true }).notNull(),
    createdAt   : timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    // 唯一键含 field：「补名」与「简介」是两条独立记录，可分别重跑、分别回退。
    // book_id 为 null（跨作品）时用全零 UUID 占位参与唯一性（Postgres 的 NULL 不参与唯一约束）。
    uniqueIndex("external_knowledge_key_idx").on(
      sql`coalesce(${t.bookId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.subjectType,
      t.subjectKey,
      t.field
    ),
    index("external_knowledge_book_idx").on(t.bookId)
  ]
);
