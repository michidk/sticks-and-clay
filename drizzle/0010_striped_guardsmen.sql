ALTER TABLE "agent_runs" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
WITH "image_usage" AS (
	SELECT DISTINCT ON ("runId") "runId", "payload"
	FROM "agent_events"
	WHERE "type" = 'image.usage'
	ORDER BY "runId", "created_at" DESC
)
UPDATE "agent_runs" AS "run"
SET
	"rates" = jsonb_build_object(
		'input', 5,
		'cached', 1.25,
		'output', 30,
		'textInput', 5,
		'cachedTextInput', 1.25,
		'imageInput', 8,
		'cachedImageInput', 2,
		'imageOutput', 30,
		'source', 'OpenAI gpt-image-2 standard token pricing · 2026-10-01'
	),
	"estimatedCost" = (
		COALESCE(("usage"."payload" #>> '{input_tokens_details,text_tokens}')::double precision, ("usage"."payload" ->> 'input_tokens')::double precision, 0) * 5 +
		COALESCE(("usage"."payload" #>> '{input_tokens_details,image_tokens}')::double precision, 0) * 8 +
		COALESCE(("usage"."payload" #>> '{output_tokens_details,image_tokens}')::double precision, ("usage"."payload" ->> 'output_tokens')::double precision, 0) * 30
	) / 1000000
FROM "image_usage" AS "usage"
WHERE "run"."id" = "usage"."runId"
	AND "run"."engine" = 'imagegen'
	AND regexp_replace("run"."model", '^.*/', '') = 'gpt-image-2'
	AND "run"."estimatedCost" IS NULL;
