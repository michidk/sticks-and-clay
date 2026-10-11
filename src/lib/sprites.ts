import { z } from "zod";

export const spriteOptionsSchema = z
  .object({
    pixel: z.boolean().default(true),
    directions: z.union([z.literal(1), z.literal(4), z.literal(8)]).default(8),
    size: z
      .union([z.literal(32), z.literal(64), z.literal(128), z.literal(256)])
      .default(64),
    frameCount: z.number().int().min(1).max(16).default(1),
    clip: z.string().trim().max(100).default(""),
    fps: z.number().int().min(1).max(60).default(12),
    loop: z.boolean().default(true),
    elevation: z.number().min(0).max(90).default(30),
    zoom: z.number().min(0.5).max(2).default(1),
    padding: z.number().min(0).max(0.3).default(0.08),
    anchor: z.enum(["ground", "center"]).default("ground"),
    colors: z.number().int().min(2).max(32).default(16),
    palette: z
      .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
      .min(2)
      .max(32)
      .optional(),
    outline: z
      .union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)])
      .default(""),
  })
  .refine((value) => !value.palette || value.palette.length <= value.colors, {
    message: "Custom palette exceeds the color budget",
    path: ["palette"],
  });
export type SpriteOptions = z.infer<typeof spriteOptionsSchema>;
