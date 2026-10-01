import { roleInstructions } from "./role-instructions.server";
import { roles, type RunInput } from "../roles";
import {
  recordRun,
  pricingSnapshot,
  validateCheckpoint,
} from "./accounting.server";
import { Client } from "eve/client";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { runs, events } from "../../../db/schema";
import { imagePart } from "../../../lib/storage.server";
import { assertJobActive } from "../../../lib/queue.server";
import { prompt } from "../../../lib/prompts.server";
import { price } from "../../../lib/contracts";
import { recoveryAction } from "../../../lib/recovery";
import { checkpoint, jobContext } from "../../../lib/checkpoint.server";
import { resolve } from "node:path";
import { DATA } from "../../../lib/storage.server";
import { agentTimeoutMs } from "./timeouts";
import { loadRuntimeSettings } from "../../../lib/runtime-settings.server";
import { textRoleProfile } from "../config.server";
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
export async function agent<T>(
  args: RunInput & { schema: any },
): Promise<{ result: T; runId: string }> {
  await assertJobActive();
  const key = args.stepId
    ? `step:${args.stepId}`
    : `agent:${args.role}:${args.iteration || 0}`;
  const profile = await textRoleProfile(args.role);
  const agentModel = profile.model;
  const rates = pricingSnapshot(agentModel);
  const savedId = jobContext.getStore()?.checkpoint[key];
  const [saved] = savedId
    ? await db.select().from(runs).where(eq(runs.id, savedId))
    : [];
  if (savedId && !saved)
    throw new Error("Saved AI run is missing; cannot resume safely");
  validateCheckpoint(saved, args, "eve");
  if (saved?.status === "done")
    return { result: args.schema.parse(saved.result) as T, runId: saved.id };
  if (saved) args = { ...args, input: saved.input, images: saved.images };
  const id = saved?.id || crypto.randomUUID(),
    systemPrompt =
      await roleInstructions(args.role, saved?.systemPrompt),
    images = args.images || [];
  if (!saved)
    await recordRun(args, {
      id,
      engine: "eve",
      model: agentModel,
      systemPrompt,
      rates,
      effort: profile.effort,
    });
  await checkpoint(key, id);
  const runRates = saved?.rates || rates;
  let inputTokens = 0,
    outputTokens = 0,
    cachedTokens = 0,
    cacheWriteTokens = 0,
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
  let estimatedCost = 0,
    costAvailable = !runRates.unavailable,
    accountedInput = 0,
    accountedOutput = 0,
    accountedCached = 0,
    accountedCacheWrite = 0;
  let signal: AbortSignal | undefined;
  const saveUsage = () => {
    // Accumulate per-step estimates: the long-context tier is per request, not per session total.
    if (inputTokens !== accountedInput || outputTokens !== accountedOutput) {
      const stepCost = price(
        inputTokens - accountedInput,
        outputTokens - accountedOutput,
        cachedTokens - accountedCached,
        runRates,
        cacheWriteTokens - accountedCacheWrite,
      );
      if (stepCost === null) costAvailable = false;
      else estimatedCost += stepCost;
      accountedInput = inputTokens;
      accountedOutput = outputTokens;
      accountedCached = cachedTokens;
      accountedCacheWrite = cacheWriteTokens;
    }
    return db
      .update(runs)
      .set({
        inputTokens,
        outputTokens,
        cachedTokens,
        cacheWriteTokens,
        estimatedCost: reportedSteps + estimatedSteps && costAvailable ? estimatedCost : null,
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
  };
  try {
    signal = AbortSignal.timeout(
      agentTimeoutMs(args.role, await loadRuntimeSettings()),
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
    // Persist the effective configuration before the first turn. Existing sessions keep their snapshot.
    await mkdir(resolve(DATA, "session-config"), { recursive: true });
    const configPath = resolve(DATA, "session-config", sessionId + ".json");
    try {
      await writeFile(
        configPath,
        JSON.stringify({
          role: args.role,
          runId: id,
          model: saved?.model || agentModel,
          effort: saved?.effort || profile.effort,
        }),
        { flag: "wx" },
      );
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
    }
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
          cacheWriteTokens += usage.cacheWriteTokens || 0;
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
        event.type === "step.completed" ||
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
    if (signal?.aborted && sessionId) {
      try {
        await client().sessions.attach(sessionId).cancel({ tasks: true });
      } catch (cancelError) {
        console.error("Failed to cancel timed-out Eve session", cancelError);
      }
    }
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
            cacheWriteTokens: 0,
            usageSource: "not_started",
            estimatedCost: 0,
          })
          .where(eq(runs.id, id));
    }
  }
}
