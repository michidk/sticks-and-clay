CREATE TABLE "material_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"materialId" text NOT NULL,
	"parentId" text,
	"projectId" text NOT NULL,
	"jobId" text NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material_versions" ADD CONSTRAINT "material_versions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;