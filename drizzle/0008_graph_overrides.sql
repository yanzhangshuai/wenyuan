CREATE TABLE "graph_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"target_name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"source_feedback_id" uuid,
	"created_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "graph_overrides" ADD CONSTRAINT "graph_overrides_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_overrides" ADD CONSTRAINT "graph_overrides_source_feedback_id_pack_feedback_id_fk" FOREIGN KEY ("source_feedback_id") REFERENCES "public"."pack_feedback"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_overrides" ADD CONSTRAINT "graph_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "graph_overrides_book_idx" ON "graph_overrides" USING btree ("book_id","target_name");
