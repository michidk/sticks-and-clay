import { z } from "zod";
import { materialSchema, materialReviewResult } from "../../lib/materials";
export const exportHistorySchema = z.object({
  version: z.literal(1).default(1),
  id: z.string(),
  kind: z.string(),
  sourceRunId: z.string().optional(),
  createdAt: z.string(),
  status: z.string(),
  error: z.string().nullable(),
  files: z.array(z.string()),
  notes: z.string().optional(),
  outcome: z.string().default("unreviewed"),
  parentId: z.string().optional(),
  materialId: z.string().optional(),
});
export const materialHistorySchema = exportHistorySchema.extend({
  kind: z.literal("material"),
  parameters: materialSchema.optional(),
  review: materialReviewResult.optional(),
  validation: z
    .object({
      roughnessMean: z.number(),
      seamRatios: z.record(z.string(), z.number()),
      warnings: z.array(z.string()),
    })
    .optional(),
});
export type ExportHistory = z.infer<typeof exportHistorySchema>;
export type MaterialHistory = z.infer<typeof materialHistorySchema>;
export const workshopResultSchema = z.discriminatedUnion("kind", [
  materialHistorySchema,
  exportHistorySchema.extend({ kind: z.literal("presentation") }),
  exportHistorySchema.extend({ kind: z.literal("material-assignment") }),
]);
