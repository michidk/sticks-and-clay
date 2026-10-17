CREATE TABLE "mockups" (
	"id" text PRIMARY KEY NOT NULL,
	"projectId" text NOT NULL,
	"key" text NOT NULL,
	"source" text NOT NULL,
	"designVersion" integer NOT NULL,
	"parentId" text,
	"jobId" text,
	"runId" text,
	"note" text DEFAULT '' NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "design_revisions" ADD COLUMN "approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mockups" ADD CONSTRAINT "mockups_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mockups_project_id_idx" ON "mockups" USING btree ("projectId");--> statement-breakpoint
UPDATE "design_revisions" r SET "approved" = true FROM "projects" p WHERE r."projectId" = p."id" AND p."status" = 'ready' AND r."version" = p."designVersion";
--> statement-breakpoint
INSERT INTO "mockups" ("id", "projectId", "key", "source", "designVersion", "jobId", "runId", "created_at")
SELECT j."id" || ':' || n.i::text, j."targetId", (j."checkpoint" ->> ('mockup:' || n.i::text))::jsonb ->> 'key', 'generated',
  COALESCE(((j."checkpoint" ->> 'input')::jsonb ->> 'version')::int, 0), j."id",
  (j."checkpoint" ->> ('mockup:' || n.i::text))::jsonb ->> 'runId', j."created_at"
FROM "jobs" j CROSS JOIN generate_series(0, 3) AS n(i)
WHERE j."kind" = 'design-mockups' AND jsonb_exists(j."checkpoint", 'mockup:' || n.i::text)
  AND EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = j."targetId");
