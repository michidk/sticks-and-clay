import { Client } from "eve/client";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs, events } from "../db/schema";
import { imagePart } from "./storage.server";
import { assertJobActive } from "./queue.server";
import { prompt } from "./prompts.server";
import { price } from "./contracts";
import { recoveryAction } from "./recovery";
import { checkpoint, jobContext } from "./checkpoint.server";
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
  await assertJobActive();
  const key = `agent:${args.role}:${args.iteration || 0}`;
  const savedId = jobContext.getStore()?.checkpoint[key];
  const [saved] = savedId
    ? await db.select().from(runs).where(eq(runs.id, savedId))
    : [];
  if (saved?.status === "done")
    return { result: args.schema.parse(saved.result) as T, runId: saved.id };
  if (saved) args = { ...args, input: saved.input, images: saved.images };
  const id = saved?.id || crypto.randomUUID(),
    systemPrompt =
      saved?.systemPrompt ||
      (await readFile(`prompts/${args.role}.md`, "utf8")),
    images = args.images || [];
  if (!saved)
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
  await checkpoint(key, id);
  const runRates = saved?.rates || rates;
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
    modelStarted = false,
    stepActive = false;
  const saveUsage = () =>
    db
      .update(runs)
      .set({
        inputTokens,
        outputTokens,
        cachedTokens,
        estimatedCost:
          reportedSteps + estimatedSteps
            ? price(inputTokens, outputTokens, cachedTokens, runRates)
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
    const signal = AbortSignal.timeout(
      Number(process.env.AGENT_TIMEOUT_MS || 1200000),
    );
    // Persist an idle session before submitting work, so recovery has an identity.
    const session = saved?.sessionId
      ? client().sessions.attach(saved.sessionId)
      : (await client().sessions.create()).session;
    sessionId = session.state.sessionId;
    await db
      .update(runs)
      .set({ sessionId, status: "running", error: null, finishedAt: null })
      .where(eq(runs.id, id));
    const snapshot = await session.snapshot({ signal });
    const history = snapshot.events;
    const lastBoundary = [...history]
      .reverse()
      .find((e) =>
        [
          "turn.completed",
          "turn.failed",
          "turn.cancelled",
          "session.failed",
          "input.requested",
        ].includes(e.type),
      );
    const action = recoveryAction(
      history,
      saved?.status === "failed" &&
        Boolean(
          saved.error?.startsWith("Artifact validation:") ||
          saved.error?.startsWith("Result validation:") ||
          saved.error?.includes("JSON"),
        ),
    );
    const handle = client().sessions.attach(sessionId, {
      streamIndex: snapshot.session.streamIndex,
    });
    let continuation: AsyncIterable<(typeof history)[number]> | undefined;
    if (action === "start") {
      continuation = await handle.send(
        [
          {
            type: "text",
            text: `ROLE: ${args.role}\n\n${systemPrompt}\n\n${args.input}`,
          },
          ...(await Promise.all(images.map(imagePart))),
        ],
        { outputSchema: args.schema, signal },
      );
    } else if (action === "continue") {
      continuation = await handle.send(
        await prompt("resume", { error: saved?.error || "Interrupted turn" }),
        { outputSchema: args.schema, signal },
      );
    } else if (action === "attach") {
      continuation = handle.stream({ signal });
    }
    async function* replay() {
      for (const event of history) yield { event, historical: true };
      if (continuation)
        for await (const event of continuation)
          yield { event, historical: false };
    }
    const seen = new Set<string>();
    for await (const { event, historical } of replay()) {
      if (!historical) await assertJobActive();
      if (event.type === "turn.started") {
        complete = false;
        result = undefined;
        output = "";
      }
      const data = ("data" in event ? event.data : {}) as any;
      const fingerprint = event.meta.id;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      if (!historical && event.type === "actions.requested")
        for (const action of data.actions || [])
          await args.onActivity?.(action.toolName || "");
      if (event.type === "step.started") {
        modelStarted = true;
        stepActive = true;
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
        stepActive = false;
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
      if (
        stepActive &&
        ["turn.failed", "turn.cancelled", "session.failed"].includes(event.type)
      ) {
        inputTokens += stepInputEstimate;
        outputTokens += Math.ceil(stepOutputChars / 4);
        estimatedSteps++;
        contextChars += stepOutputChars;
        stepActive = false;
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
        await db
          .insert(events)
          .values({
            id: createHash("sha256")
              .update(id + ":" + fingerprint)
              .digest("hex"),
            runId: id,
            type: event.type,
            payload: data,
          })
          .onConflictDoNothing();
      if (
        !historical ||
        event === history[history.length - 1] ||
        event === lastBoundary
      )
        await saveUsage();
      if (
        [
          "turn.failed",
          "turn.cancelled",
          "session.failed",
          "input.requested",
        ].includes(event.type) &&
        !(historical && (continuation || event !== lastBoundary))
      )
        throw new Error(
          data.message ||
            data.code ||
            "Agent stopped or requested operator input",
        );
      if (!historical && event.type === "turn.completed") break;
    }
    if (!complete) throw new Error("Agent stream ended without completion");
    await assertJobActive();
    let parsed: T;
    try {
      parsed = args.schema.parse(
        result ?? JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, "")),
      ) as T;
    } catch (error) {
      throw new Error("Result validation: " + String(error));
    }
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
    await db
      .update(runs)
      .set({
        status: "failed",
        error: String(error),
        output: output || saved?.output,
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
      } else if (!saved)
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
