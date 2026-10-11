ALTER TABLE "agent_runs" ADD COLUMN "engine" text DEFAULT 'eve' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "step_id" text;
--> statement-breakpoint
UPDATE "agent_runs" SET "engine" = 'tanstack'
WHERE "sessionId" IS NULL AND "role" IN ('project-brief', 'model-brief', 'designer')
AND NOT EXISTS (SELECT 1 FROM jobs WHERE checkpoint ->> 'agent:designer:0' = agent_runs.id);
