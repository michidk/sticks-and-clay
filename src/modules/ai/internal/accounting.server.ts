import { createHash } from "node:crypto";
import { db } from "../../../db/client";
import { runs } from "../../../db/schema";
import { roles, type RunInput } from "../roles";

export function pricingSnapshot(model?: string) {
  if (model === "gpt-6-astra")
    return {
      input: 10,
      cached: 1,
      output: 50,
      source:
        "OpenAI gpt-6-astra standard token pricing · 2026-09-29 · https://developers.openai.com/api/docs/models/gpt-6-astra",
      longContextThreshold: 272000,
      longContextInputMultiplier: 2,
      longContextOutputMultiplier: 1.5,
    };
  const rates = {
    input: Number(process.env.INPUT_USD_PER_MILLION || 2),
    cached: Number(process.env.CACHED_USD_PER_MILLION || 0.2),
    output: Number(process.env.OUTPUT_USD_PER_MILLION || 10),
    source:
      process.env.PRICE_SOURCE ||
      "Operator assumption; verify configured model rates",
  };
  if (
    [rates.input, rates.cached, rates.output].some(
      (n) => !Number.isFinite(n) || n < 0,
    )
  )
    throw new Error("Invalid token pricing rates");
  return rates;
}

export async function recordRun(
  args: RunInput,
  details: {
    id: string;
    engine: "eve" | "tanstack";
    model: string;
    systemPrompt: string;
    rates: ReturnType<typeof pricingSnapshot>;
  },
) {
  await db.insert(runs).values({
    ...details,
    effort: roles[args.role].effort,
    projectId: args.projectId,
    batchId: args.batchId,
    modelId: args.modelId,
    role: args.role,
    iteration: args.iteration || 0,
    stepId: args.stepId || `${args.role}:${args.iteration || 0}`,
    promptVersion: createHash("sha256")
      .update(details.systemPrompt)
      .digest("hex")
      .slice(0, 8),
    input: args.input,
    images: args.images || [],
  });
}

export function validateCheckpoint(
  saved: typeof runs.$inferSelect | undefined,
  args: RunInput,
  engine: "eve" | "tanstack",
) {
  if (
    saved &&
    (saved.projectId !== args.projectId ||
      saved.role !== args.role ||
      saved.engine !== engine ||
      saved.iteration !== (args.iteration || 0) ||
      (saved.modelId || undefined) !== args.modelId ||
      (saved.batchId || undefined) !== args.batchId)
  )
    throw new Error("AI checkpoint belongs to a different task or engine");
}
