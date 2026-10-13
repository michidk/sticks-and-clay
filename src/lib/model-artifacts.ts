import { z } from "zod";

/** Additive projection: preserve older archive fields without rewriting them. */
export const archivedModelSchema = z
  .object({
    glb: z.string(),
    blend: z.string(),
    renders: z.array(z.string()),
    script: z.string().optional(),
    sourceBundle: z.string().optional(),
    buildManifest: z.string().optional(),
    sprites: z.object({ image: z.string(), layout: z.string() }).optional(),
    textures: z
      .array(z.object({ key: z.string(), name: z.string(), kind: z.string() }))
      .optional(),
    lods: z.array(z.object({ key: z.string() }).passthrough()).optional(),
    metrics: z.record(z.string(), z.unknown()).default({}),
    handover: z
      .object({ outputSha256: z.string(), manifest: z.string() })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ArchivedModel = z.infer<typeof archivedModelSchema>;

export const archivedPhotographySchema = z.object({
  runId: z.string(),
  builderRunId: z.string(),
  glb: z.string(),
  glbSha256: z.string(),
  renders: z.array(z.string()),
  manifest: z.string(),
});
