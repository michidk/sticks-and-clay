CREATE TABLE "asset_history" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"asset_id" text NOT NULL,
	"version_id" text,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_history" ADD CONSTRAINT "asset_history_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_history_asset_id_idx" ON "asset_history" USING btree ("asset_id","created_at");--> statement-breakpoint
-- Records from before this log existed, reconstructed from the timestamps the rows keep.
INSERT INTO "asset_history" ("asset_id", "kind", "detail", "created_at")
SELECT "id", 'created', jsonb_strip_nulls(jsonb_build_object('title', "title", 'backfilled', true)), "created_at" FROM "assets";
--> statement-breakpoint
INSERT INTO "asset_history" ("asset_id", "kind", "detail", "created_at")
SELECT "id", 'ready', '{"backfilled":true}', "ready_at" FROM "assets" WHERE "ready_at" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "asset_history" ("asset_id", "version_id", "kind", "detail", "created_at")
SELECT "asset_id", "id", 'version', jsonb_strip_nulls(jsonb_build_object('branchKind', "branch_kind", 'changePrompt', "change_prompt", 'backfilled', true)), "created_at" + interval '1 millisecond' FROM "asset_versions";
--> statement-breakpoint
INSERT INTO "asset_history" ("asset_id", "version_id", "kind", "detail", "created_at")
SELECT v."asset_id", v."id", 'status', jsonb_strip_nulls(jsonb_build_object('to', v."status", 'phase', v."phase", 'verdict', v."verdict", 'backfilled', true)),
  coalesce((SELECT max(j."finishedAt") FROM "jobs" j WHERE j."targetId" = v."id"), v."created_at")
FROM "asset_versions" v WHERE v."status" <> 'queued';
--> statement-breakpoint
INSERT INTO "asset_history" ("asset_id", "version_id", "kind", "detail", "created_at")
SELECT "asset_id", "id", 'accepted', '{"backfilled":true}', "accepted_at" FROM "asset_versions" WHERE "accepted_at" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION log_asset_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE settings jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "asset_history" ("asset_id", "kind", "detail")
    VALUES (NEW."id", 'created', jsonb_strip_nulls(jsonb_build_object('title', NEW."title", 'prompt', NEW."input"->>'prompt')));
    RETURN NEW;
  END IF;
  SELECT coalesce(jsonb_agg(k ORDER BY k), '[]') INTO settings
  FROM (SELECT jsonb_object_keys(OLD."input") k UNION SELECT jsonb_object_keys(NEW."input")) keys
  WHERE k <> 'prompt' AND OLD."input"->k IS DISTINCT FROM NEW."input"->k;
  IF NEW."title" IS DISTINCT FROM OLD."title" OR NEW."input"->>'prompt' IS DISTINCT FROM OLD."input"->>'prompt' OR settings <> '[]' THEN
    INSERT INTO "asset_history" ("asset_id", "kind", "detail") VALUES (NEW."id", 'edited', jsonb_strip_nulls(jsonb_build_object(
      'title', CASE WHEN NEW."title" IS DISTINCT FROM OLD."title" THEN jsonb_build_object('from', OLD."title", 'to', NEW."title") END,
      'prompt', CASE WHEN NEW."input"->>'prompt' IS DISTINCT FROM OLD."input"->>'prompt' THEN jsonb_build_object('from', OLD."input"->>'prompt', 'to', NEW."input"->>'prompt') END,
      'settings', CASE WHEN settings <> '[]' THEN settings END)));
  END IF;
  IF (NEW."ready_at" IS NULL) <> (OLD."ready_at" IS NULL) THEN
    INSERT INTO "asset_history" ("asset_id", "kind") VALUES (NEW."id", CASE WHEN NEW."ready_at" IS NULL THEN 'unready' ELSE 'ready' END);
  END IF;
  IF NEW."in_idea" <> OLD."in_idea" THEN
    INSERT INTO "asset_history" ("asset_id", "kind") VALUES (NEW."id", CASE WHEN NEW."in_idea" THEN 'returned_to_ideas' ELSE 'started' END);
  END IF;
  IF NEW."references" IS DISTINCT FROM OLD."references" OR NEW."reference_notes" IS DISTINCT FROM OLD."reference_notes" THEN
    INSERT INTO "asset_history" ("asset_id", "kind", "detail") VALUES (NEW."id", 'references', jsonb_build_object(
      'from', jsonb_array_length(OLD."references"), 'to', jsonb_array_length(NEW."references")));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER asset_history_log AFTER INSERT OR UPDATE ON "assets" FOR EACH ROW EXECUTE FUNCTION log_asset_history();
--> statement-breakpoint
CREATE FUNCTION log_asset_version_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "asset_history" ("asset_id", "version_id", "kind", "detail")
    VALUES (NEW."asset_id", NEW."id", 'version', jsonb_strip_nulls(jsonb_build_object('branchKind', NEW."branch_kind", 'changePrompt', NEW."change_prompt")));
    RETURN NEW;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    INSERT INTO "asset_history" ("asset_id", "version_id", "kind", "detail")
    VALUES (NEW."asset_id", NEW."id", 'status', jsonb_strip_nulls(jsonb_build_object(
      'from', OLD."status", 'to', NEW."status", 'phase', NEW."phase", 'verdict', NEW."verdict", 'error', NEW."error")));
  END IF;
  IF (NEW."accepted_at" IS NULL) <> (OLD."accepted_at" IS NULL) THEN
    INSERT INTO "asset_history" ("asset_id", "version_id", "kind")
    VALUES (NEW."asset_id", NEW."id", CASE WHEN NEW."accepted_at" IS NULL THEN 'unaccepted' ELSE 'accepted' END);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER asset_version_history_log AFTER INSERT OR UPDATE ON "asset_versions" FOR EACH ROW EXECUTE FUNCTION log_asset_version_history();
--> statement-breakpoint
-- now() is fixed per transaction; several events from one change must keep their order.
CREATE FUNCTION stamp_asset_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."created_at" := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER asset_history_stamp BEFORE INSERT ON "asset_history" FOR EACH ROW EXECUTE FUNCTION stamp_asset_history();
