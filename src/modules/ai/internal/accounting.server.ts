import { createHash } from "node:crypto";
import { db } from "../../../db/client";
import { runs } from "../../../db/schema";
import type { RunInput } from "../roles";

export type PricingSnapshot = {
  input: number;
  cached: number;
  cacheWrite?: number;
  output: number;
  source: string;
  unavailable?: boolean;
  longContextThreshold?: number;
  longContextInputMultiplier?: number;
  longContextOutputMultiplier?: number;
  textInput?: number;
  cachedTextInput?: number;
  imageInput?: number;
  cachedImageInput?: number;
  imageOutput?: number;
};

const OPENAI_PRICING_DATE = "2026-10-01";
const longContext = {
  longContextThreshold: 272_000,
  longContextInputMultiplier: 2,
  longContextOutputMultiplier: 1.5,
} as const;
const textPricing: Record<string, PricingSnapshot> = {
  "gpt-6-sol": {
    input: 2,
    cached: 0.2,
    cacheWrite: 2.5,
    output: 10,
    ...longContext,
    source: `OpenAI gpt-6-sol standard token pricing · ${OPENAI_PRICING_DATE}`,
  },
  "gpt-6-astra": {
    input: 10,
    cached: 1,
    cacheWrite: 12.5,
    output: 50,
    ...longContext,
    source: `OpenAI gpt-6-astra standard token pricing · ${OPENAI_PRICING_DATE}`,
  },
};
const imagePricing: Record<string, PricingSnapshot> = {
  "gpt-image-2": {
    // Generic fields preserve the existing run snapshot contract. Detailed fields
    // price the text/image split reported by the Image API.
    input: 5,
    cached: 1.25,
    output: 30,
    textInput: 5,
    cachedTextInput: 1.25,
    imageInput: 8,
    cachedImageInput: 2,
    imageOutput: 30,
    source: `OpenAI gpt-image-2 standard token pricing · ${OPENAI_PRICING_DATE}`,
  },
};

function canonicalModel(model?: string) {
  return (model || "").split("/").at(-1) || "unknown";
}

function unavailablePricing(model?: string): PricingSnapshot {
  return {
    input: 0,
    cached: 0,
    output: 0,
    unavailable: true,
    source: `No code-owned pricing for ${canonicalModel(model)}`,
  };
}

export function pricingSnapshot(model?: string): PricingSnapshot {
  return textPricing[canonicalModel(model)] || unavailablePricing(model);
}

export function imagePricingSnapshot(model?: string): PricingSnapshot {
  return imagePricing[canonicalModel(model)] || unavailablePricing(model);
}

export function imagePrice(
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
    output_tokens_details?: { image_tokens?: number };
  },
  rates: PricingSnapshot,
) {
  if (rates.unavailable) return null;
  const inputText = usage.input_tokens_details?.text_tokens;
  const inputImage = usage.input_tokens_details?.image_tokens;
  const outputImage = usage.output_tokens_details?.image_tokens;
  if (inputText !== undefined || inputImage !== undefined || outputImage !== undefined)
    return (
      (inputText || 0) * (rates.textInput ?? rates.input) +
      (inputImage || 0) * (rates.imageInput ?? rates.input) +
      (outputImage ?? usage.output_tokens ?? 0) * (rates.imageOutput ?? rates.output)
    ) / 1e6;
  return (
    (usage.input_tokens || 0) * rates.input +
    (usage.output_tokens || 0) * rates.output
  ) / 1e6;
}

export async function recordRun(
  args: RunInput,
  details: {
    id: string;
    engine: "eve" | "tanstack";
    model: string;
    systemPrompt: string;
    rates: PricingSnapshot;
    effort: "low" | "medium" | "high";
  },
) {
  await db.insert(runs).values({
    ...details,
    effort: details.effort,
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
