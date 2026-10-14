CREATE TYPE "public"."analysis_run_status" AS ENUM('running', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."analysis_stage" AS ENUM('dictionary', 'extract', 'grounding', 'review', 'vote', 'merge', 'aggregate');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('PERSON', 'LOCATION', 'ORGANIZATION', 'CONCEPT');--> statement-breakpoint
CREATE TYPE "public"."name_type" AS ENUM('NAMED', 'TITLE_ONLY');--> statement-breakpoint
CREATE TYPE "public"."relation_direction" AS ENUM('SYMMETRIC', 'INVERSE');--> statement-breakpoint
CREATE TYPE "public"."relation_status" AS ENUM('ACTIVE', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."work_status" AS ENUM('pending', 'parsing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "analysis_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stage" "analysis_stage" NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"error_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"chapter_ordinal" integer,
	"code" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"status" "analysis_run_status" DEFAULT 'running' NOT NULL,
	"model_snapshot" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"skill_snapshot" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"canonical" text NOT NULL,
	"normalized_name" text NOT NULL,
	"type" "entity_type" NOT NULL,
	"name_type" "name_type" DEFAULT 'NAMED' NOT NULL,
	"faction_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"normalized_alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paragraph_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"surface" text NOT NULL,
	"normalized_surface" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_spans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"relationship_id" uuid,
	"paragraph_id" uuid NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"quote" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relation_types" (
	"code" varchar(32) PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"category" integer NOT NULL,
	"direction" "relation_direction" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"relation_type_code" varchar(32) NOT NULL,
	"start_chapter" integer NOT NULL,
	"end_chapter" integer,
	"status" "relation_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"raw_text" text NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paragraphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"start_offset" integer DEFAULT 0 NOT NULL,
	"end_offset" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"status" "work_status" DEFAULT 'pending' NOT NULL,
	"chapter_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_calls" ADD CONSTRAINT "analysis_calls_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_issues" ADD CONSTRAINT "analysis_issues_run_id_analysis_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."analysis_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_paragraph_id_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."paragraphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_spans" ADD CONSTRAINT "evidence_spans_relationship_id_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."relationships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_spans" ADD CONSTRAINT "evidence_spans_paragraph_id_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."paragraphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_source_entity_id_entities_id_fk" FOREIGN KEY ("source_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_target_entity_id_entities_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_relation_type_code_relation_types_code_fk" FOREIGN KEY ("relation_type_code") REFERENCES "public"."relation_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paragraphs" ADD CONSTRAINT "paragraphs_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_calls_run_stage_idx" ON "analysis_calls" USING btree ("run_id","stage");--> statement-breakpoint
CREATE INDEX "analysis_issues_run_code_idx" ON "analysis_issues" USING btree ("run_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_work_normname_uq" ON "entities" USING btree ("work_id","normalized_name");--> statement-breakpoint
CREATE INDEX "entities_work_type_idx" ON "entities" USING btree ("work_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_aliases_work_nornalias_uq" ON "entity_aliases" USING btree ("work_id","normalized_alias");--> statement-breakpoint
CREATE INDEX "entity_aliases_entity_idx" ON "entity_aliases" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_mentions_entity_idx" ON "entity_mentions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_mentions_paragraph_idx" ON "entity_mentions" USING btree ("paragraph_id");--> statement-breakpoint
CREATE INDEX "evidence_spans_relationship_idx" ON "evidence_spans" USING btree ("relationship_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relationships_triple_uq" ON "relationships" USING btree ("work_id","source_entity_id","target_entity_id","relation_type_code");--> statement-breakpoint
CREATE INDEX "relationships_source_idx" ON "relationships" USING btree ("work_id","source_entity_id");--> statement-breakpoint
CREATE INDEX "relationships_target_idx" ON "relationships" USING btree ("work_id","target_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_work_ordinal_uq" ON "chapters" USING btree ("work_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "paragraphs_chapter_ordinal_uq" ON "paragraphs" USING btree ("chapter_id","ordinal");