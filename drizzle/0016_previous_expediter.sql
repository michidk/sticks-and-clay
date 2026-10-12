CREATE TABLE "model_ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"input" jsonb NOT NULL,
	"batchId" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_ideas" ADD CONSTRAINT "model_ideas_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_ideas" ADD CONSTRAINT "model_ideas_batchId_batches_id_fk" FOREIGN KEY ("batchId") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_ideas_project_id_idx" ON "model_ideas" USING btree ("projectId");