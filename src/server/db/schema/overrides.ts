import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { books } from "./books";
import { packFeedback } from "./packs";
import { users } from "./users";

/**
 * 图谱覆盖层（人工修正）。
 *
 * ## 为什么不能直接改 `entities` 表
 *
 * `persistGraph` 是 **DELETE + 重插**：下次解析会把整个图谱删掉重建，
 * 人工 `UPDATE entities` 的改动会被整体冲掉，而且没有任何提示。
 *
 * 所以人工修正是**读时叠加**的：图谱表保持解析产物的原样，
 * 读路径（`loadGraphSnapshot`）把覆盖层应用上去。这与现有的不确定性层、
 * 外部资料层同构 —— 都是「读时派生、不写图谱表」。
 *
 * ## 为什么按规范名索引，而不是 entity id
 *
 * 重跑后所有实体 uuid 都会变（DELETE + 重插），按 id 存的覆盖会全部失配。
 * 规范名在同一本书里相对稳定，是唯一能跨重跑存活的键。
 *
 * 代价：实体被改名或合并后，覆盖会「找不到目标」。这种情况**保留并标记未生效**，
 * 而不是静默丢弃 —— 静默丢弃等于用户改了却不知道没生效。
 *
 * ## 能力边界（重要）
 *
 * `GraphNode` 不带别名，所以：
 * - `hide_entity` / `change_type` → **当前图谱立刻可见**；
 * - `drop_alias` / `add_alias` → 当前图谱**看不见**（快照里没有别名字段），
 *   只影响下次解析的 P5 归并。而「错并」的实体已经物理合并成一个 uuid，
 *   摘别名不会让它们分开 —— 拆分只能靠改配置 + 重跑。
 */
export const GRAPH_OVERRIDE_KINDS = [
  "hide_entity",
  "change_type",
  "drop_alias",
  "add_alias"
] as const;
export type GraphOverrideKind = (typeof GRAPH_OVERRIDE_KINDS)[number];

/** 实体类型（与 `entities.type` 的枚举一致）。 */
export const OVERRIDE_ENTITY_TYPES = ["PERSON", "LOCATION", "ORGANIZATION", "CONCEPT"] as const;
export type OverrideEntityType = (typeof OVERRIDE_ENTITY_TYPES)[number];

/** 载荷（按 kind 取不同形状）。 */
export type GraphOverridePayload =
  | { kind: "hide_entity" }
  | { kind: "change_type"; type: OverrideEntityType }
  | { kind: "drop_alias"; alias: string }
  | { kind: "add_alias"; alias: string };

export const graphOverrides = pgTable(
  "graph_overrides",
  {
    id    : uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    kind      : text("kind").$type<GraphOverrideKind>().notNull(),
    /** 作用对象的**规范名**（不是 uuid，理由见文件头）。 */
    targetName: text("target_name").notNull(),
    payload   : jsonb("payload").$type<GraphOverridePayload>().notNull(),

    /** 从哪条读者反馈来的（可追溯）；管理员直接改的为 null。 */
    sourceFeedbackId: uuid("source_feedback_id").references(() => packFeedback.id, {
      onDelete: "set null"
    }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    note     : text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    // 读路径每次都要按 bookId 取全量覆盖，这条索引是热路径。
    index("graph_overrides_book_idx").on(t.bookId, t.targetName)
  ]
);
