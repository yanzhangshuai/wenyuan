CREATE TABLE "external_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid,
	"subject_type" text NOT NULL,
	"subject_key" text NOT NULL,
	"field" text NOT NULL,
	"value" text,
	"resolution" text NOT NULL,
	"source_urls" text[] DEFAULT '{}' NOT NULL,
	"snapshot_hash" text,
	"confidence" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_knowledge" ADD CONSTRAINT "external_knowledge_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_knowledge_key_idx" ON "external_knowledge" USING btree (coalesce("book_id", '00000000-0000-0000-0000-000000000000'::uuid),"subject_type","subject_key","field");--> statement-breakpoint
CREATE INDEX "external_knowledge_book_idx" ON "external_knowledge" USING btree ("book_id");