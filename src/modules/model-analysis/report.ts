import { z } from "zod";
const finding = z
  .object({
    code: z.string(),
    object: z.string(),
    count: z.number(),
    confidence: z.string().optional(),
    node: z.number().nullable().optional(),
    mesh: z.number().nullable().optional(),
    triangles: z.array(z.number()).optional(),
    polygons: z.array(z.number()).optional(),
    faces: z
      .array(z.object({ primitive: z.number(), triangle: z.number() }))
      .optional(),
    material: z.number().optional(),
    slot: z.string().optional(),
    texCoord: z.number().optional(),
    countIsLowerBound: z.boolean().optional(),
  })
  .passthrough();
export const analysisReportSchema = z
  .object({
    version: z.number(),
    sha256: z.string().optional(),
    faceSpace: z.string().optional(),
    findings: z.array(finding),
    unavailable: z.array(z.string()).default([]),
    limitations: z.array(z.string()).default([]),
    truncated: z.boolean().optional(),
  })
  .passthrough();
export type AnalysisReport = z.infer<typeof analysisReportSchema>;

/** Recover the exact advisory evidence recorded in the judge input, including old runs. */
export function recordedAnalysis(input: string): AnalysisReport | undefined {
  const marker = "\nDETERMINISTIC ANALYSIS (read-only, advisory)\n";
  const start = input.lastIndexOf(marker);
  if (start < 0) return;
  try {
    const result = analysisReportSchema.safeParse(
      JSON.parse(input.slice(start + marker.length).split("\n")[0]),
    );
    return result.success ? result.data : undefined;
  } catch {
    return;
  }
}
