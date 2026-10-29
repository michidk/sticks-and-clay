import { z } from "zod";

const texturePlan = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("generate"),
    name: z.string().min(1).max(80),
    purpose: z.string().min(10).max(500),
    targets: z.array(z.string().min(1).max(160)).min(1).max(24),
    baseColorPrompt: z.string().min(20).max(1200),
    normalStrategy: z.string().min(10).max(500),
    uvStrategy: z.string().min(10).max(500),
    scale: z.string().min(1).max(200),
  }),
  z.object({
    mode: z.literal("reuse"),
    name: z.string().min(1).max(80),
    purpose: z.string().min(10).max(500),
    targets: z.array(z.string().min(1).max(160)).min(1).max(24),
    source: z.string().min(1).max(500),
    uvStrategy: z.string().min(10).max(500),
    scale: z.string().min(1).max(200),
  }),
  z.object({
    mode: z.literal("none"),
    name: z.string().min(1).max(80),
    purpose: z.string().min(10).max(500),
    targets: z.array(z.string().min(1).max(160)).min(1).max(24),
    reason: z.string().min(10).max(500),
  }),
]);

export const productionPlanResult = z.object({
  version: z.literal(1),
  summary: z.string().min(40).max(4000),
  surfaceStrategy: z.enum(["image-textures", "flat-color", "vertex-colors", "procedural-material"]),
  materials: z.array(z.object({
    name: z.string().min(1).max(80),
    purpose: z.string().min(10).max(500),
    nodeTargets: z.array(z.string().min(1).max(160)).min(1).max(24),
    slotName: z.string().min(1).max(80),
  })).max(24),
  textures: z.array(texturePlan).max(24),
  steps: z.array(z.string().min(10).max(700)).min(1).max(16),
  checks: z.array(z.string().min(10).max(700)).min(1).max(16),
});

export type ProductionPlan = z.infer<typeof productionPlanResult>;

export function productionPlanText(plan: ProductionPlan) {
  return JSON.stringify(plan, null, 2);
}
