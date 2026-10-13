import { provider } from "./provider.server";
import { roles, type RunInput } from "../roles";
import {
  recordRun,
  pricingSnapshot,
  validateCheckpoint,
} from "./accounting.server";
import { roleInstructions } from "./role-instructions.server";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { runs } from "../../../db/schema";
import { chat, type TokenUsage } from "@tanstack/ai";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { checkpoint, jobContext } from "../../../lib/checkpoint.server";
import { price } from "../../../lib/contracts";
import { imagePart } from "../../../lib/storage.server";
import { textRoleProfile } from "../config.server";
export async function draftBrief(args: RunInput) {
  const checkpointKey = args.stepId
    ? `step:${args.stepId}`
    : "direct:" + args.role;
  const priorId = jobContext.getStore()?.checkpoint[checkpointKey];
  if (priorId) {
    const [prior] = await db.select().from(runs).where(eq(runs.id, priorId));
    if (!prior)
      throw new Error("Saved AI run is missing; cannot recover safely");
    validateCheckpoint(prior, args, "tanstack");
    if (prior?.status === "done")
      return { ...(prior.result as any), runId: prior.id };
    if (prior?.status === "running")
      await db
        .update(runs)
        .set({
          status: "failed",
          error: "Process interrupted; response usage may be unavailable",
          finishedAt: new Date(),
        })
        .where(eq(runs.id, priorId));
  }
  const profile = await textRoleProfile(args.role);
  const id = crypto.randomUUID(),
    system = await roleInstructions(args.role, undefined, args.construction);
  const model = profile.model;
  const rates = pricingSnapshot(model);
  await recordRun(args, {
    id,
    engine: "tanstack",
    model,
    systemPrompt: system,
    rates,
    effort: profile.effort,
  });
  if (jobContext.getStore()) await checkpoint(checkpointKey, id);
  let output = "",
    usage: TokenUsage | undefined;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    profile.settings.timeouts.tanstackMs,
  );
  const saveUsage = async () => {
    const input =
      usage?.promptTokens ??
      Math.ceil((system.length + args.input.length) / 4) +
        (args.images?.length || 0) * 1000;
    const out = usage?.completionTokens ?? Math.ceil(output.length / 4);
    const cached = usage?.promptTokensDetails?.cachedTokens || 0;
    const cacheWrite = usage?.promptTokensDetails?.cacheWriteTokens || 0;
    await db
      .update(runs)
      .set({
        output,
        inputTokens: input,
        outputTokens: out,
        cachedTokens: cached,
        cacheWriteTokens: cacheWrite,
        usageSource: usage ? "reported" : "estimated",
        estimatedCost: price(input, out, cached, rates, cacheWrite),
      })
      .where(eq(runs.id, id));
  };
  try {
    const { key, url } = await provider();
    const images = await Promise.all((args.images || []).map(imagePart));
    const result = await chat({
      adapter: createOpenaiChat(
        model as Parameters<typeof createOpenaiChat>[0],
        key,
        { baseURL: url, maxRetries: 0 },
      ),
      systemPrompts: [system],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", content: args.input },
            ...images.map((i) => ({
              type: "image" as const,
              source: { type: "url" as const, value: i.data },
            })),
          ],
        },
      ],
      outputSchema: roles[args.role].schema,
      modelOptions: { reasoning: { effort: profile.effort } },
      stream: false,
      abortController: controller,
      middleware: [
        {
          name: "studio-history",
          onUsage: async (_ctx, next) => {
            usage = {
              promptTokens: (usage?.promptTokens || 0) + next.promptTokens,
              completionTokens:
                (usage?.completionTokens || 0) + next.completionTokens,
              totalTokens: (usage?.totalTokens || 0) + next.totalTokens,
              promptTokensDetails: {
                cachedTokens:
                  (usage?.promptTokensDetails?.cachedTokens || 0) +
                  (next.promptTokensDetails?.cachedTokens || 0),
                cacheWriteTokens:
                  (usage?.promptTokensDetails?.cacheWriteTokens || 0) +
                  (next.promptTokensDetails?.cacheWriteTokens || 0),
              },
            };
            await saveUsage();
          },
          onFinish: (_ctx, info) => {
            output = info.content;
            usage = info.usage || usage;
          },
        },
      ],
    });
    output = JSON.stringify(result, null, 2);
    await saveUsage();
    await db
      .update(runs)
      .set({ result, status: "done", finishedAt: new Date() })
      .where(eq(runs.id, id));
    return { ...result, runId: id };
  } catch (error) {
    await db
      .update(runs)
      .set({ status: "failed", error: String(error), finishedAt: new Date() })
      .where(eq(runs.id, id));
    if (usage || output) await saveUsage();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
