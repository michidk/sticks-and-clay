import { Client } from "eve/client";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs, events } from "../db/schema";
import { imagePart } from "./storage.server";
import { price } from "./contracts";
export const agentModel = process.env.STUDIO_MODEL || "gpt-6-sol";
const rates = {
  input: Number(process.env.INPUT_USD_PER_MILLION || 2),
  cached: Number(process.env.CACHED_USD_PER_MILLION || 0.2),
  output: Number(process.env.OUTPUT_USD_PER_MILLION || 10),
  source:
    process.env.PRICE_SOURCE ||
    "Operator assumption; verify rates for the configured model",
};
if (
  [rates.input, rates.output, rates.cached].some(
    (n) => !Number.isFinite(n) || n < 0,
  )
)
  throw new Error("Token pricing rates must be finite, nonnegative numbers");
const client = () =>
  new Client({
    host: process.env.EVE_URL || "http://127.0.0.1:33441",
    auth: {
      basic: {
        username: "studio",
        password: process.env.EVE_PASSWORD || "studio-local-agent",
      },
    },
  });
export async function agent<T>(args: {
  projectId: string;
  batchId?: string;
  modelId?: string;
  role: string;
  iteration?: number;
  input: string;
  images?: string[];
  schema: any;
  onActivity?: (tool: string) => Promise<void>;
}): Promise<{ result: T; runId: string }> {
  const id = crypto.randomUUID(),
    systemPrompt = await readFile(`prompts/${args.role}.md`, "utf8"),
    images = args.images || [];
  await db.insert(runs).values({
    id,
    projectId: args.projectId,
    batchId: args.batchId,
    modelId: args.modelId,
    role: args.role,
    iteration: args.iteration || 0,
    model: agentModel,
    promptVersion: createHash("sha256")
      .update(systemPrompt)
      .digest("hex")
      .slice(0, 8),
    systemPrompt,
    input: args.input,
    images,
    rates,
  });
  let inputTokens = 0,
    outputTokens = 0,
    cachedTokens = 0,
    reportedSteps = 0,
    estimatedSteps = 0,
    output = "",
    result: unknown,
    sessionId: string | undefined,
    complete = false;
  let contextChars = systemPrompt.length + args.input.length,
    stepOutputChars = 0,
    stepInputEstimate = 0,
    modelStarted = false;
  const saveUsage = () =>
    db
      .update(runs)
      .set({
        inputTokens,
        outputTokens,
        cachedTokens,
        estimatedCost:
          reportedSteps + estimatedSteps
            ? price(inputTokens, outputTokens, cachedTokens, rates)
            : null,
        usageSource: estimatedSteps
          ? reportedSteps
            ? "mixed"
            : "estimated"
          : reportedSteps
            ? "reported"
            : "pending",
        output,
      })
      .where(eq(runs.id, id));
  try {
    const response = (
      await client().sessions.create({
        message: [
          {
            type: "text",
            text: `ROLE: ${args.role}\n\n${systemPrompt}\n\n${args.input}`,
          },
          ...(await Promise.all(images.map(imagePart))),
        ],
        outputSchema: args.schema,
        signal: AbortSignal.timeout(
          Number(process.env.AGENT_TIMEOUT_MS || 1200000),
        ),
      })
    ).response;
    sessionId = response.sessionId;
    await db.update(runs).set({ sessionId }).where(eq(runs.id, id));
    const seen = new Set<string>();
    for await (const event of response) {
      const data = ("data" in event ? event.data : {}) as any;
      const fingerprint = event.meta.id;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      if (event.type === "actions.requested")
        for (const action of data.actions || [])
          await args.onActivity?.(action.toolName || "");
      if (event.type === "step.started") {
        modelStarted = true;
        stepOutputChars = 0;
        stepInputEstimate = Math.ceil(contextChars / 4) + images.length * 1000;
        await db
          .update(runs)
          .set({ model: data.modelId || agentModel })
          .where(eq(runs.id, id));
      }
      if (event.type === "message.appended") {
        stepOutputChars += (data.messageDelta || "").length;
        continue;
      }
      if (event.type === "action.input.appended") {
        stepOutputChars += (data.inputTextDelta || "").length;
        continue;
      }
      if (event.type === "step.completed") {
        const usage = data.usage;
        if (usage && (usage.inputTokens || 0) + (usage.outputTokens || 0) > 0) {
          inputTokens += usage.inputTokens || 0;
          outputTokens += usage.outputTokens || 0;
          cachedTokens += usage.cacheReadTokens || 0;
          reportedSteps++;
        } else {
          inputTokens += stepInputEstimate;
          outputTokens += Math.ceil(stepOutputChars / 4);
          estimatedSteps++;
        }
        contextChars += stepOutputChars;
      }
      if (event.type === "action.result")
        contextChars += JSON.stringify(data, (_key, value) =>
          value && typeof value === "object" && value.type === "image"
            ? { type: "image", estimatedTokens: 1000 }
            : value,
        ).length;
      if (event.type === "message.completed") output = data.message || output;
      if (event.type === "result.completed") {
        result = data.result;
        output = output || JSON.stringify(result, null, 2);
      }
      if (event.type === "turn.completed") complete = true;
      if (!event.type.endsWith(".appended") && !event.type.endsWith(".delta"))
        await db.insert(events).values({
          id: crypto.randomUUID(),
          runId: id,
          type: event.type,
          payload: data,
        });
      await saveUsage();
      if (
        [
          "turn.failed",
          "turn.cancelled",
          "session.failed",
          "input.requested",
        ].includes(event.type)
      )
        throw new Error(
          data.message ||
            data.code ||
            "Agent stopped or requested operator input",
        );
    }
    if (!complete) throw new Error("Agent stream ended without completion");
    const parsed = args.schema.parse(
      result ?? JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, "")),
    ) as T;
    await db
      .update(runs)
      .set({
        status: "done",
        result: parsed,
        output: output || JSON.stringify(parsed, null, 2),
        finishedAt: new Date(),
      })
      .where(eq(runs.id, id));
    return { result: parsed, runId: id };
  } catch (error) {
    if (sessionId)
      await client()
        .sessions.attach(sessionId)
        .cancel({ tasks: true })
        .catch(() => {});
    await db
      .update(runs)
      .set({
        status: "failed",
        error: String(error),
        output,
        finishedAt: new Date(),
      })
      .where(eq(runs.id, id));
    throw error;
  } finally {
    if (!reportedSteps && !estimatedSteps) {
      if (modelStarted) {
        inputTokens = Math.ceil(contextChars / 4) + images.length * 1000;
        outputTokens = Math.ceil(Math.max(output.length, stepOutputChars) / 4);
        estimatedSteps++;
        await saveUsage();
      } else
        await db
          .update(runs)
          .set({
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            usageSource: "not_started",
            estimatedCost: 0,
          })
          .where(eq(runs.id, id));
    }
  }
}
