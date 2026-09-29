import { z } from "zod";
export const briefResult = z.object({ brief: z.string().min(10).max(12000) });
export const designResult = z.object({ design: z.string().min(100) });
export const planResult = z.object({
  models: z
    .array(z.object({ name: z.string().min(1), prompt: z.string().min(20) }))
    .min(1)
    .max(20),
});
export const buildResult = z.object({
  summary: z.string(),
  limitations: z.array(z.string()),
});
export const judgeResult = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  summary: z.string(),
  improvements: z.array(
    z.object({
      priority: z.enum(["critical", "major", "minor"]),
      issue: z.string(),
      action: z.string(),
      view: z.string(),
    }),
  ),
});
export function nextStage(passed: boolean, iteration: number, limit: number) {
  return passed ? "approved" : iteration >= limit ? "limit_reached" : "revise";
}
export function price(
  input: number,
  output: number,
  cached: number,
  rates: {
    input: number;
    output: number;
    cached: number;
    longContextThreshold?: number;
    longContextInputMultiplier?: number;
    longContextOutputMultiplier?: number;
  },
) {
  const long =
    rates.longContextThreshold !== undefined &&
    input > rates.longContextThreshold;
  const inputMultiplier = long ? rates.longContextInputMultiplier || 1 : 1;
  const outputMultiplier = long ? rates.longContextOutputMultiplier || 1 : 1;
  return (
    (Math.max(0, input - cached) * rates.input * inputMultiplier +
      Math.min(input, cached) * rates.cached * inputMultiplier +
      output * rates.output * outputMultiplier) /
    1e6
  );
}
export function progress(
  iteration: number,
  limit: number,
  stage: "build" | "judge" | "done",
) {
  return stage === "done"
    ? 100
    : Math.round(
        ((iteration * 2 + (stage === "judge" ? 1 : 0)) / (1 + limit * 2)) * 100,
      );
}
