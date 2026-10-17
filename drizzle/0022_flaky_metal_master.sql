ALTER TABLE "model_ideas" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "accepted_at" timestamp with time zone;