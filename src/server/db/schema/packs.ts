import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { books } from "./books";

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

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    // 一本书一份配置：查询按 bookId 走唯一索引，同时防止并发写出两份。
    uniqueIndex("book_packs_book_uq").on(t.bookId),
    index("book_packs_status_idx").on(t.status)
  ]
);
