import { z } from "zod";

const timeoutMs = z.number().int().min(60_000).max(24 * 60 * 60 * 1000);
export const effortSchema = z.enum(["low", "medium", "high"]);
export const imageQualitySchema = z.enum(["low", "medium", "high"]);
export const imageSizeSchema = z.enum(["1024x1024", "1024x1536", "1536x1024"]);

export const timeoutSettingsSchema = z.object({
  agentMs: timeoutMs,
  builderMs: timeoutMs,
  blenderSeconds: z.number().int().min(60).max(2 * 60 * 60),
  tanstackMs: timeoutMs,
  imageMs: timeoutMs,
  collectionMs: timeoutMs,
  analysisBlenderMs: timeoutMs,
  analysisPythonMs: timeoutMs,
});
const agentOverrideSchema = z.object({
  model: z.string().trim().min(1).max(100),
  effort: effortSchema,
});
const imageOverrideSchema = z.object({
  model: z.string().trim().min(1).max(100),
  quality: imageQualitySchema,
});
const queueSettingsSchema = z.object({
  paused: z.boolean(),
  concurrency: z.number().int().min(1).max(4),
});
const generationDefaultsSchema = z.object({
  count: z.number().int().min(1).max(20),
  judgeIterations: z.number().int().min(0).max(5),
  imageSize: imageSizeSchema,
});
export const runtimeSettingsSchema = z
  .object({
    version: z.literal(3),
    timeouts: timeoutSettingsSchema,
    queue: queueSettingsSchema,
    agents: z.record(z.string(), agentOverrideSchema),
    imageAgents: z.record(z.string(), imageOverrideSchema),
    generationDefaults: generationDefaultsSchema,
  })
  .superRefine((settings, ctx) => {
    if (settings.timeouts.builderMs < settings.timeouts.blenderSeconds * 1000)
      ctx.addIssue({
        code: "custom",
        path: ["timeouts", "builderMs"],
        message: "Builder timeout must cover one Blender execution",
      });
  });
export const runtimeSettingsPatchSchema = z.object({
  timeouts: timeoutSettingsSchema.partial().optional(),
  queue: queueSettingsSchema.partial().optional(),
  agents: z.record(z.string(), agentOverrideSchema.nullable()).optional(),
  imageAgents: z.record(z.string(), imageOverrideSchema.nullable()).optional(),
  generationDefaults: generationDefaultsSchema.partial().optional(),
});
export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;
export type RuntimeSettingsPatch = z.infer<typeof runtimeSettingsPatchSchema>;

export const projectNameResult = z.object({
  name: z.string().trim().min(1).max(100),
});
export const briefResult = z.object({ brief: z.string().min(10).max(12000) });
export const designResult = z.object({ design: z.string().min(100) });
export const planResult = z.object({
  models: z.array(z.object({ name: z.string().min(1), prompt: z.string().min(20) })).min(1).max(20),
});
export const buildResult = z.object({ summary: z.string(), limitations: z.array(z.string()) });
export const judgeResult = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  summary: z.string(),
  improvements: z.array(z.object({
    priority: z.enum(["critical", "major", "minor"]),
    issue: z.string(),
    action: z.string(),
    view: z.string(),
  })),
});
export function nextStage(passed: boolean, iteration: number, limit: number) {
  return passed ? "approved" : iteration >= limit ? "limit_reached" : "revise";
}
export function price(input: number, output: number, cached: number, rates: {
  input: number; output: number; cached: number; cacheWrite?: number; unavailable?: boolean;
  longContextThreshold?: number; longContextInputMultiplier?: number; longContextOutputMultiplier?: number;
}, cacheWrite = 0) {
  if (rates.unavailable) return null;
  const long = rates.longContextThreshold !== undefined && input > rates.longContextThreshold;
  const inputMultiplier = long ? rates.longContextInputMultiplier || 1 : 1;
  const outputMultiplier = long ? rates.longContextOutputMultiplier || 1 : 1;
  return (Math.max(0, input - cached - cacheWrite) * rates.input * inputMultiplier +
    Math.min(input, cached) * rates.cached * inputMultiplier +
    Math.min(Math.max(0, input - cached), cacheWrite) * (rates.cacheWrite ?? rates.input) * inputMultiplier +
    output * rates.output * outputMultiplier) / 1e6;
}
export function progress(iteration: number, limit: number, stage: "build" | "judge" | "done") {
  return stage === "done" ? 100 : Math.round(((iteration * 2 + (stage === "judge" ? 1 : 0)) / (1 + limit * 2)) * 100);
}
