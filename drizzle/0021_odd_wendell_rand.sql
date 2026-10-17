ALTER TABLE "projects" ADD COLUMN "reference_notes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Accepted mockups become reference images (up to the limit of six) and keep their notes.
WITH picked AS (
  SELECT m."projectId", m.key, m.note, row_number() OVER (PARTITION BY m."projectId" ORDER BY m.accepted_at DESC) AS rn
  FROM "mockups" m
  JOIN "projects" p ON p.id = m."projectId"
  WHERE m.accepted_at IS NOT NULL AND NOT (p."references" ? m.key)
)
UPDATE "projects" p SET
  "references" = p."references" || (SELECT jsonb_agg(k.key ORDER BY k.rn) FROM picked k WHERE k."projectId" = p.id AND jsonb_array_length(p."references") + k.rn <= 6),
  "reference_notes" = COALESCE((SELECT jsonb_object_agg(k.key, k.note) FROM picked k WHERE k."projectId" = p.id AND k.note <> '' AND jsonb_array_length(p."references") + k.rn <= 6), '{}'::jsonb)
WHERE EXISTS (SELECT 1 FROM picked k WHERE k."projectId" = p.id AND jsonb_array_length(p."references") + k.rn <= 6);
