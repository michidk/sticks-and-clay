ALTER TABLE "model_ideas" RENAME TO "assets";--> statement-breakpoint
ALTER TABLE "models" RENAME TO "asset_versions";--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "model_ideas_projectId_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "model_ideas_batchId_batches_id_fk";
--> statement-breakpoint
ALTER TABLE "asset_versions" DROP CONSTRAINT "models_projectId_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "asset_versions" DROP CONSTRAINT "models_batchId_batches_id_fk";
--> statement-breakpoint
DROP INDEX "model_ideas_project_id_idx";--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "in_idea" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "reference_notes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD COLUMN "asset_id" text DEFAULT NULL;--> statement-breakpoint
-- Existing version IDs, run references, jobs, checkpoints and storage keys stay unchanged.
CREATE TEMP TABLE asset_roots ON COMMIT DROP AS
WITH RECURSIVE ancestry AS (
  SELECT id AS version_id, id AS root_id, "projectId", parent_model_id, branch_kind, ARRAY[id] AS visited, 0 AS depth FROM asset_versions
  UNION ALL
  SELECT a.version_id, p.id, p."projectId", p.parent_model_id, p.branch_kind, a.visited || p.id, a.depth + 1
  FROM ancestry a JOIN asset_versions p ON p.id = a.parent_model_id AND p."projectId" = a."projectId"
  WHERE a.branch_kind = 'iterate' AND NOT p.id = ANY(a.visited)
)
SELECT DISTINCT ON (version_id) version_id, root_id FROM ancestry ORDER BY version_id, depth DESC;
--> statement-breakpoint
CREATE TEMP TABLE asset_owners ON COMMIT DROP AS
WITH roots AS (
  SELECT v.*, (SELECT a.id FROM assets a WHERE a."batchId" = v."batchId" AND a."projectId" = v."projectId" ORDER BY a.created_at, a.id LIMIT 1) AS idea_id
  FROM asset_versions v JOIN asset_roots r ON r.version_id = v.id AND r.root_id = v.id
), numbered AS (
  SELECT *, row_number() OVER (PARTITION BY idea_id ORDER BY created_at, id) AS ordinal FROM roots
)
SELECT id AS root_id, CASE WHEN idea_id IS NOT NULL AND ordinal = 1 THEN idea_id ELSE id END AS asset_id FROM numbered;
--> statement-breakpoint
INSERT INTO assets (id, "projectId", title, input, "batchId", in_idea, created_at)
SELECT o.asset_id, v."projectId", replace(v.name, '_', ' '),
 jsonb_build_object('prompt', v.prompt, 'count', 1, 'judgeIterations', b."judgeIterations", 'imageSize', b.image_size, 'visualTargetMode', CASE WHEN b.visual_target_mode = 'skip' THEN 'skip' ELSE 'review' END)
 || CASE WHEN b."spriteTarget" IS NOT NULL THEN jsonb_build_object('spriteTarget', b."spriteTarget") ELSE '{}'::jsonb END,
 v."batchId", false, v.created_at
FROM asset_owners o JOIN asset_versions v ON v.id = o.root_id JOIN batches b ON b.id = v."batchId"
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
UPDATE asset_versions v SET asset_id = o.asset_id FROM asset_roots r JOIN asset_owners o ON o.root_id = r.root_id WHERE v.id = r.version_id;
--> statement-breakpoint
UPDATE assets a SET in_idea = false WHERE EXISTS (SELECT 1 FROM asset_versions v WHERE v.asset_id = a.id) OR a."batchId" IS NOT NULL;
--> statement-breakpoint
-- A saved multi-result idea becomes independent assets without dropping its intended work.
INSERT INTO assets (id, "projectId", title, input, ready_at, created_at)
SELECT gen_random_uuid()::text, a."projectId", a.title, jsonb_set(a.input, '{count}', '1'), a.ready_at, a.created_at
FROM assets a CROSS JOIN LATERAL generate_series(2, LEAST(20, COALESCE((a.input->>'count')::integer, 1))) n WHERE a.in_idea;
--> statement-breakpoint
-- Reserve one identity for every legacy planner result still owed.
INSERT INTO assets (id, "projectId", title, input, "batchId", in_idea, created_at)
SELECT gen_random_uuid()::text, b."projectId", COALESCE(NULLIF(b.prompt, ''), 'Asset'),
 jsonb_build_object('prompt', COALESCE(NULLIF(b.prompt, ''), 'Complete the approved asset design'), 'count', 1, 'judgeIterations', b."judgeIterations", 'imageSize', b.image_size), b.id, false, b.created_at
FROM batches b CROSS JOIN LATERAL generate_series(1, GREATEST(0, b.count - (SELECT count(*)::integer FROM assets a WHERE a."batchId" = b.id))) n
WHERE b.status IN ('queued', 'planning', 'failed');
--> statement-breakpoint
UPDATE assets SET input = jsonb_set(input, '{count}', '1');
--> statement-breakpoint
ALTER TABLE asset_versions ALTER COLUMN asset_id SET NOT NULL;
--> statement-breakpoint
CREATE FUNCTION assign_asset_version_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_project text; parent_asset text; batch_row batches%ROWTYPE;
BEGIN
  IF NEW.asset_id IS NULL AND NEW.branch_kind = 'iterate' THEN
    SELECT asset_id INTO parent_asset FROM asset_versions WHERE id = NEW.parent_model_id AND "projectId" = NEW."projectId";
    NEW.asset_id := parent_asset;
  END IF;
  IF NEW.asset_id IS NULL AND NEW.branch_kind IS DISTINCT FROM 'fork' THEN
    SELECT a.id INTO NEW.asset_id FROM assets a WHERE a."batchId" = NEW."batchId" AND a."projectId" = NEW."projectId" AND NOT a.in_idea
      AND NOT EXISTS (SELECT 1 FROM asset_versions v WHERE v.asset_id = a.id) ORDER BY a.created_at, a.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  END IF;
  IF NEW.asset_id IS NULL THEN
    SELECT * INTO STRICT batch_row FROM batches WHERE id = NEW."batchId" AND "projectId" = NEW."projectId";
    NEW.asset_id := NEW.id;
    INSERT INTO assets(id, "projectId", title, input, "batchId", in_idea)
    VALUES (NEW.asset_id, NEW."projectId", replace(NEW.name, '_', ' '), jsonb_build_object('prompt', NEW.prompt, 'count', 1, 'judgeIterations', batch_row."judgeIterations", 'imageSize', batch_row.image_size)
      || CASE WHEN batch_row.workshop ? 'parts' THEN jsonb_build_object('parts', batch_row.workshop->'parts') ELSE '{}'::jsonb END, NEW."batchId", false);
  END IF;
  SELECT "projectId" INTO owner_project FROM assets WHERE id = NEW.asset_id FOR UPDATE;
  IF owner_project IS DISTINCT FROM NEW."projectId" THEN RAISE EXCEPTION 'Asset and version must belong to the same project'; END IF;
  UPDATE assets SET in_idea = false, "batchId" = NEW."batchId" WHERE id = NEW.asset_id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER asset_version_owner BEFORE INSERT ON asset_versions FOR EACH ROW EXECUTE FUNCTION assign_asset_version_owner();

--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_batchId_batches_id_fk" FOREIGN KEY ("batchId") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_versions" ADD CONSTRAINT "asset_versions_batchId_batches_id_fk" FOREIGN KEY ("batchId") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_project_id_idx" ON "assets" USING btree ("projectId");