ALTER TABLE "analysis_runs" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "slices_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "slices_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD COLUMN "log_path" text;
