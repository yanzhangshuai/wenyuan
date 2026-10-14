-- 0001: 把「作品」域命名从 work 统一改为 book。
--
-- 背景：代码标识符已全量改名（workId→bookId、listWorks→listBooks 等），
-- schema 定义同步改名，本迁移使**数据库对象**与之对齐，消除「库与代码命名不一致」。
--
-- 安全性：全部使用 ALTER ... RENAME —— PostgreSQL 的元数据操作，
-- **不重写表、不丢数据、不改变行内容**，仅改对象名。
-- 索引与约束随所属表/列自动改名（PostgreSQL 9.2+ 行为），
-- 此处显式重命名索引与约束，以使名称与 Drizzle schema 声明完全一致。

-- ── 1. 枚举类型 ──
ALTER TYPE "public"."work_status" RENAME TO "book_status";
--> statement-breakpoint

-- ── 2. 主表 ──
ALTER TABLE "public"."works" RENAME TO "books";
--> statement-breakpoint

-- ── 3. 各表的外键列 work_id → book_id ──
ALTER TABLE "public"."chapters" RENAME COLUMN "work_id" TO "book_id";
--> statement-breakpoint
ALTER TABLE "public"."entities" RENAME COLUMN "work_id" TO "book_id";
--> statement-breakpoint
ALTER TABLE "public"."entity_aliases" RENAME COLUMN "work_id" TO "book_id";
--> statement-breakpoint
ALTER TABLE "public"."relationships" RENAME COLUMN "work_id" TO "book_id";
--> statement-breakpoint
ALTER TABLE "public"."analysis_runs" RENAME COLUMN "work_id" TO "book_id";
--> statement-breakpoint

-- ── 4. 外键约束改名 ──
ALTER TABLE "public"."chapters" RENAME CONSTRAINT "chapters_work_id_works_id_fk" TO "chapters_book_id_books_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."entities" RENAME CONSTRAINT "entities_work_id_works_id_fk" TO "entities_book_id_books_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."entity_aliases" RENAME CONSTRAINT "entity_aliases_work_id_works_id_fk" TO "entity_aliases_book_id_books_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."relationships" RENAME CONSTRAINT "relationships_work_id_works_id_fk" TO "relationships_book_id_books_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."analysis_runs" RENAME CONSTRAINT "analysis_runs_work_id_works_id_fk" TO "analysis_runs_book_id_books_id_fk";
--> statement-breakpoint

-- ── 5. 索引改名 ──
ALTER INDEX "public"."chapters_work_ordinal_uq" RENAME TO "chapters_book_ordinal_uq";
--> statement-breakpoint
ALTER INDEX "public"."entities_work_normname_uq" RENAME TO "entities_book_normname_uq";
--> statement-breakpoint
ALTER INDEX "public"."entities_work_type_idx" RENAME TO "entities_book_type_idx";
--> statement-breakpoint
ALTER INDEX "public"."entity_aliases_work_nornalias_uq" RENAME TO "entity_aliases_book_nornalias_uq";
