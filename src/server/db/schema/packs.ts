import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { PackMetrics } from "@/server/modules/analysis/pack-suggest/metrics";

import { books } from "./books";
import { users } from "./users";

/**
 * 作品包（每本书自己的「解析条件」）。
 *
 * ## 为什么要有这张表
 *
 * 人名/地名/别名组原先硬编码在 `genre-pack/works/*.ts`：新书进来只能拿到空词典，
 * 通用分词器会把「夏侯惇」切碎 → 候选名单缺人 → 抽取质量下降，且**不报错**。
 * 每加一本书都要改代码重部署，这条路不可扩展。
 *
 * ## 与代码内置包的关系是「回落链」，不是「覆盖」
 *
 * ```
 * loadWorkPack(bookId)
 *   ├─ 库里有记录 → 用库里的（source 标记它从哪来）
 *   ├─ 库里没有   → 按书名匹配内置包（儒林/红楼照旧）
 *   └─ 都没有     → 空词典（现状，由审计 issue 记录）
 * ```
 *
 * 内置包**保留不动**：它们是被金标验证过的基线（儒林 1-1 实体 89.74），
 * 删掉就等于让那个数字不可复现。
 */

/** 库里的专名条目。`postag` 128=人名 / 64=地名，与 `segmentit` 词性码一致。 */
export interface PackProperNoun {
  name  : string;
  postag: number;
}

/** 配置来源。 */
export const BOOK_PACK_SOURCES = ["builtin", "generated", "custom"] as const;
export type BookPackSource = (typeof BOOK_PACK_SOURCES)[number];

/** 配置状态：`draft` 表示自动生成、尚未经人确认。 */
export const BOOK_PACK_STATUSES = ["draft", "confirmed"] as const;
export type BookPackStatus = (typeof BOOK_PACK_STATUSES)[number];

export const bookPacks = pgTable(
  "book_packs",
  {
    id    : uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),

    /** 来源：内置包复制 / AI 生成 / 手工填写。 */
    source: text("source").$type<BookPackSource>().notNull().default("custom"),
    /**
     * 状态。`draft` 的意义是**让第一次解析的结果可归因**：
     * 若图谱里出现错并，先看这次解析用的是不是未审核的配置。
     */
    status: text("status").$type<BookPackStatus>().notNull().default("draft"),

    properNouns: jsonb("proper_nouns").$type<PackProperNoun[]>().notNull().default([]),
    aliasGroups: jsonb("alias_groups").$type<string[][]>().notNull().default([]),

    /** 生成建议的留档（L2 的模型、成本、候选数）。人工填的为 `null`。 */
    suggestionNote: text("suggestion_note"),

    /**
     * 生成质量指标（只有自动生成的配置有）。
     *
     * 为什么存库而不是每次现算：指标里的「被砍掉的别名数」是**生成过程**的产物，
     * 事后从最终配置里算不出来（那些别名已经不在库里了）。
     */
    metrics: jsonb("metrics").$type<PackMetrics | null>(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    // 一本书一份配置：查询按 bookId 走唯一索引，同时防止并发写出两份。
    uniqueIndex("book_packs_book_uq").on(t.bookId),
    index("book_packs_status_idx").on(t.status)
  ]
);

/**
 * 读者反馈（L3）。
 *
 * ## 定位：把「用户的困惑」变成「管理员的待办」
 *
 * 它不是众包标注 —— 单个读者的一次反馈没有任何统计意义。
 * 价值在于**聚合**：同一条别名组被 3 个人标记「这俩不是一个人」，就该去看那组。
 *
 * ## 为什么只收四类
 *
 * 每一类都对应一个**具体的、能落地的修改动作**：
 *
 * | kind | 用户的动作 | 管理员的动作 |
 * | --- | --- | --- |
 * | `wrong_merge` | 指着两个名字说「不是一人」 | 拆开那组别名 |
 * | `missing_entity` | 说「这本书里还有某某」 | 加进专名词典 |
 * | `wrong_type` | 说「这是地名不是人名」 | 改 postag |
 * | `missing_alias` | 说「某某还叫某某」 | 往组里加一个别名 |
 *
 * 不收「这条关系抽错了」：关系由 P1 逐片抽取 + 投票，改一条要重跑整片，
 * 不是配置层面能修的东西 —— 收了只会给管理员一个点不动的按钮。
 */
export const FEEDBACK_KINDS = [
  "wrong_merge",
  "missing_entity",
  "wrong_type",
  "missing_alias"
] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** 反馈状态。 */
export const FEEDBACK_STATUSES = ["pending", "accepted", "rejected"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** 反馈载荷（按 kind 取不同形状）。 */
export type FeedbackPayload =
  | { kind: "wrong_merge"; names: string[] }
  | { kind: "missing_entity"; name: string; chapterHint?: string }
  | { kind: "wrong_type"; name: string; expectedType: string }
  | { kind: "missing_alias"; name: string; alias: string };

export const packFeedback = pgTable(
  "pack_feedback",
  {
    id    : uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    kind    : text("kind").$type<FeedbackKind>().notNull(),
    payload : jsonb("payload").$type<FeedbackPayload>().notNull(),
    /** 提交人。仅登录用户可提交（可追溯、可防滥用）。 */
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status    : text("status").$type<FeedbackStatus>().notNull().default("pending"),
    /** 处理说明（拒绝时写原因，接受时写改了什么）。 */
    note      : text("note"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt : timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    // 队列页按「作品 + 状态」取，且要按时间倒序。
    index("pack_feedback_book_status_idx").on(t.bookId, t.status, t.createdAt),
    index("pack_feedback_status_idx").on(t.status)
  ]
);
