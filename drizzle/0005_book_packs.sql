CREATE TABLE "book_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"source" text DEFAULT 'custom' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"proper_nouns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"alias_groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggestion_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_packs" ADD CONSTRAINT "book_packs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_packs_book_uq" ON "book_packs" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "book_packs_status_idx" ON "book_packs" USING btree ("status");
