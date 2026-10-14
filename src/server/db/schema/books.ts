import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { bookStatusEnum } from "./enums";

/**
 * 作品域表：`books` / `chapters` / `paragraphs`。
 *
 * 层级关系：一部作品含多章，一章含多段。
 * `paragraphs` 是全系统的**证据定位锚点** —— 所有实体提及与关系证据都落到段落坐标，
 * 因此段落一经写入即视为不可变（重新导入应新建作品而非改写段落）。
 */

/** 作品。 */
export const books = pgTable("books", {
  id          : uuid("id").primaryKey().defaultRandom(),
  title       : text("title").notNull(),
  author      : text("author"),
  status      : bookStatusEnum("status").notNull().default("pending"),
  chapterCount: integer("chapter_count").notNull().default(0),
  createdAt   : timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt   : timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

/** 章节。 */
export const chapters = pgTable(
  "chapters",
  {
    id    : uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    ordinal  : integer("ordinal").notNull(),
    title    : text("title").notNull(),
    rawText  : text("raw_text").notNull(),
    charCount: integer("char_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    // 唯一索引同时承担「按作品列章」的查询职责，无需再建普通索引。
    uniqueIndex("chapters_book_ordinal_uq").on(t.bookId, t.ordinal)
  ]
);

/** 段落（证据定位锚点）。 */
export const paragraphs = pgTable(
  "paragraphs",
  {
    id       : uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    ordinal    : integer("ordinal").notNull(),
    text       : text("text").notNull(),
    startOffset: integer("start_offset").notNull().default(0),
    endOffset  : integer("end_offset").notNull().default(0)
  },
  (t) => [
    // 同上：唯一索引可支撑 `chapter_id` 前缀查询。
    uniqueIndex("paragraphs_chapter_ordinal_uq").on(t.chapterId, t.ordinal)
  ]
);
