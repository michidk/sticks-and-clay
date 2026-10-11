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
});
export type MaterialParameters = z.infer<typeof materialSchema>;
export const materialPlanResult = z.object({
  parameters: materialSchema,
  notes: z.string().min(1).max(3000),
});

export const spriteOptionsSchema = z.object({
  pixel: z.boolean().default(true),
  directions: z.union([z.literal(1), z.literal(4), z.literal(8)]).default(8),
  size: z
    .union([z.literal(32), z.literal(64), z.literal(128), z.literal(256)])
    .default(64),
  frameCount: z.number().int().min(1).max(16).default(1),
  clip: z.string().trim().max(100).default(""),
  fps: z.number().int().min(1).max(60).default(12),
  colors: z.number().int().min(2).max(32).default(16),
  palette: z
    .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
    .min(2)
    .max(32)
    .optional(),
  outline: z
    .union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)])
    .default(""),
});
export type SpriteOptions = z.infer<typeof spriteOptionsSchema>;
