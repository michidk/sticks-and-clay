import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { chat, type TokenUsage } from "@tanstack/ai";
import { createOpenaiChat } from "@tanstack/ai-openai";
import { checkpoint, jobContext } from "./checkpoint.server";
import { briefResult, designResult, price } from "./contracts";
import { imagePart } from "./storage.server";
async function provider() {
  let auth: any = {},
    config: any = {};
  try {
    auth = JSON.parse(
      await readFile(join(homedir(), ".codex/auth.json"), "utf8"),
    );
  } catch (e: any) {
    if (e.code !== "ENOENT")
      throw new Error("Cannot read configured API credentials");
  }
  try {
    config = parse(
      await readFile(join(homedir(), ".codex/config.toml"), "utf8"),
    );
  } catch (e: any) {
    if (e.code !== "ENOENT") throw new Error("Cannot read configured provider");
  }
  const selected = config.model_providers?.[config.model_provider] || {};
  const key =
    auth.OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env[selected.env_key];
  const url =
    process.env.OPENAI_BASE_URL ||
    selected.base_url ||
    "https://api.openai.com/v1";
  if (!key) throw new Error("No configured API credential available");
  return { key, url };
}
export async function draftBrief(args: {
  projectId: string;
  role: "project-brief" | "model-brief" | "designer";
  input: string;
  images?: string[];
}) {
  const priorId = jobContext.getStore()?.checkpoint["direct:" + args.role];
  if (priorId) {
    const [prior] = await db.select().from(runs).where(eq(runs.id, priorId));
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
  const id = crypto.randomUUID(),
    system = await readFile(`prompts/${args.role}.md`, "utf8");
  const model = process.env.STUDIO_MODEL || "gpt-6-sol";
  const rates = {
    input: Number(process.env.INPUT_USD_PER_MILLION || 2),
    cached: Number(process.env.CACHED_USD_PER_MILLION || 0.2),
    output: Number(process.env.OUTPUT_USD_PER_MILLION || 10),
    source:
      process.env.PRICE_SOURCE ||
      "Operator assumption; verify configured model rates",
  };
  if (
    [rates.input, rates.output, rates.cached].some(
      (n) => !Number.isFinite(n) || n < 0,
    )
  )
    throw new Error("Invalid token pricing rates");
  await db.insert(runs).values({
    id,
    projectId: args.projectId,
    role: args.role,
    model,
    systemPrompt: system,
    promptVersion: createHash("sha256")
      .update(system)
      .digest("hex")
      .slice(0, 8),
    input: args.input,
    images: args.images || [],
    rates,
  });
  if (jobContext.getStore()) await checkpoint("direct:" + args.role, id);
  let output = "",
    usage: TokenUsage | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  const saveUsage = async () => {
    const input =
      usage?.promptTokens ??
      Math.ceil((system.length + args.input.length) / 4) +
        (args.images?.length || 0) * 1000;
    const out = usage?.completionTokens ?? Math.ceil(output.length / 4);
    const cached = usage?.promptTokensDetails?.cachedTokens || 0;
    await db
      .update(runs)
      .set({
        output,
        inputTokens: input,
        outputTokens: out,
        cachedTokens: cached,
        usageSource: usage ? "reported" : "estimated",
        estimatedCost: price(input, out, cached, rates),
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
      outputSchema: args.role === "designer" ? designResult : briefResult,
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
