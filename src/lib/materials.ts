import { z } from "zod";

export const materialRecipes = [
  "sand",
  "gravel",
  "stone",
  "wood",
  "brick",
  "painted_metal",
] as const;
export const materialSchema = z.object({
  recipe: z.enum(materialRecipes).default("gravel"),
  size: z
    .union([
      z.literal(64),
      z.literal(128),
      z.literal(256),
      z.literal(512),
      z.literal(1024),
    ])
    .default(512),
  seed: z.number().int().min(0).max(2147483647).default(1),
  tileMetres: z.number().min(0.1).max(20).default(1),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#80796b"),
  roughness: z.number().min(0.05).max(1).default(0.8),
  reliefMm: z.number().min(0.1).max(100).default(12),
  featureMm: z.number().min(0.5).max(500).default(35),
  coverage: z.number().min(0).max(1).default(0.65),
  wear: z.number().min(0).max(1).default(0.25),
  moisture: z.number().min(0).max(1).default(0),
  dirt: z.number().min(0).max(1).default(0),
  burial: z.number().min(0).max(1).default(0.35),
  sizeSpread: z.number().min(0).max(1).default(0.45),
  calibration: z.number().min(0).max(1).default(0),
});
export type MaterialParameters = z.infer<typeof materialSchema>;
export const materialPlanResult = z.object({
  parameters: materialSchema,
  notes: z.string().min(1).max(3000),
});
export const materialBuildResult = z.object({
  script: z.string().min(20).max(100000),
  notes: z.string().max(3000),
  requirements: z
    .array(
      z.object({
        feature: z.string(),
        construction: z.string(),
        evidence: z.string(),
      }),
    )
    .max(20),
});
export const materialReviewResult = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  assessment: z.string(),
  findings: z
    .array(
      z.object({
        severity: z.enum(["minor", "major", "critical"]),
        feature: z.string(),
        evidence: z.string(),
        correction: z.string(),
      }),
    )
    .max(12),
});

export { spriteOptionsSchema, type SpriteOptions } from "./sprites";
