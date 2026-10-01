import { createHash } from "node:crypto";
import { db } from "../../../db/client";
import { runs } from "../../../db/schema";
import type { RunInput } from "../roles";
import type { RuntimeSettings } from "../../../lib/contracts";
import { runtimeSettingsDefaults } from "../../../lib/runtime-settings";

export function pricingSnapshot(model?: string, settings: RuntimeSettings = runtimeSettingsDefaults()) {
  return model === "gpt-6-astra" ? settings.pricing.astra : settings.pricing.defaultText;
}

export async function recordRun(
  args: RunInput,
  details: {
    id: string;
    engine: "eve" | "tanstack";
    model: string;
    systemPrompt: string;
    rates: ReturnType<typeof pricingSnapshot>;
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
