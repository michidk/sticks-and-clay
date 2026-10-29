import { evePassword } from "../../../lib/eve-config.server";
import { roleInstructions } from "./role-instructions.server";
import { type RunInput } from "../roles";
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
import { effortSchema, price } from "../../../lib/contracts";
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
        password: evePassword(),
      },
    },
  });

export function parseStructuredOutput(output: string): unknown {
  if (!output.trim()) return undefined;
  const cleaned = output.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  // Providers sometimes add a short lead-in around the JSON object.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  return undefined;
}

export async function agent<T>(
  args: RunInput & { schema: any; retryFinalization?: number; restart?: boolean },
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
  const savedSnapshot = saved?.sessionId
    ? await client().sessions.attach(saved.sessionId).snapshot({
        signal: AbortSignal.timeout(agentTimeoutMs(args.role, profile.settings)),
      }).catch(async (error: unknown) => {
        await db.update(runs).set({
          status: "failed", error: String(error), finishedAt: new Date(),
        }).where(eq(runs.id, saved.id));
        throw error;
      })
    : undefined;
  const restart = args.restart || (savedSnapshot && recoveryAction(savedSnapshot.events) === "restart");
  // A dead workflow or lost sandbox cannot continue. Retain its run and usage.
  const id = (!restart && saved?.id) || crypto.randomUUID(),
    systemPrompt = await roleInstructions(
      args.role,
      saved?.systemPrompt,
      args.construction,
      args.guides,
    ),
    images = args.images || [];
  if (!saved || restart)
    await recordRun(args, {
      id,
      engine: "eve",
      model: saved?.model || agentModel,
      systemPrompt,
      rates: saved?.rates || rates,
      effort: effortSchema.parse(saved?.effort || profile.effort),
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
        estimatedCost:
          reportedSteps + estimatedSteps && costAvailable
            ? estimatedCost
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
  };
  try {
    signal = AbortSignal.timeout(
      agentTimeoutMs(args.role, await loadRuntimeSettings()),
    );
    // Persist an idle session before submitting work, so recovery has an identity.
    const session = saved?.sessionId && !restart
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
    const snapshot = (!restart && savedSnapshot) || await session.snapshot({ signal });
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
        await prompt("eve/resume", { error: saved?.error || "Interrupted turn" }),
        { outputSchema: args.schema, signal },
      );
    } else if (action === "attach") {
      continuation = handle.stream({
        signal,
        // Blender can stay silent across reconnects; the role deadline bounds recovery.
        streamReconnectPolicy: {
          streamIdleReconnectPolicy: { maxAttempts: Infinity },
        },
      });
    }
    async function* replay() {
      for (const event of history) yield { event, historical: true };
      if (continuation)
        for await (const event of continuation)
          yield { event, historical: false };
    }
    const seen = new Set<string>();
    const finalOutputCallIds = new Set<string>();
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
      if (event.type === "actions.requested")
        for (const action of data.actions || []) {
          if ((action.toolName || action.name) === "final_output" && (action.callId || action.id))
            finalOutputCallIds.add(action.callId || action.id);
          if (!historical) await args.onActivity?.(action.toolName || action.name || "");
        }
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
      if (event.type === "action.result") {
        // Some Eve versions emit the structured final_output only as an action
        // result and omit result.completed. Preserve it as the run result.
        const actionResult = data.result ?? data;
        const isFinalOutput = actionResult && (
          finalOutputCallIds.has(actionResult.callId) ||
          actionResult.toolName === "final_output" ||
          actionResult.name === "final_output"
        );
        const value = actionResult && (actionResult.output ?? actionResult.result ?? actionResult.value);
        if (isFinalOutput || value !== undefined) {
          if (value && typeof value === "object") result = value;
          else if (typeof value === "string") {
            const parsed = parseStructuredOutput(value);
            if (parsed !== undefined) result = parsed;
          }
        }
        // Image payloads are intentionally replaced before they are persisted,
        // so their serialized placeholder is only a few characters long. Keep
        // the text estimate and add the documented 1,000-token image estimate
        // explicitly; otherwise vision turns are dramatically underpriced when
        // Eve does not report provider usage.
        let imageCount = 0;
        const serialized = JSON.stringify(data, (_key, value) => {
          if (value && typeof value === "object" && value.type === "image") {
            imageCount++;
            return { type: "image" };
          }
          return value;
        });
        contextChars += serialized.length + imageCount * 4_000;
      }
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
    }
    signal.throwIfAborted();
    if (!complete) throw new Error("Agent stream ended without completion");
    // The live stream can end at turn.completed before the durable event tail
    // is visible. Re-read the session tail once before declaring the result
    // missing; this also covers reconnects where action.result was persisted
    // after the stream cursor stopped.
    if (result === undefined && sessionId) {
      const tail = await client().sessions.attach(sessionId).snapshot({ signal });
      for (const event of tail.events) {
        const data = ("data" in event ? event.data : {}) as any;
        if (event.type === "result.completed" && data.result !== undefined)
          result = data.result;
        if (event.type === "action.result") {
          const action = data.result ?? data;
          const value = action?.output ?? action?.result ?? action?.value;
          if (value && typeof value === "object") result = value;
          else if (typeof value === "string") {
            const parsed = parseStructuredOutput(value);
            if (parsed !== undefined) result = parsed;
          }
        }
        if (result !== undefined) break;
      }
    }
    // Eve normally emits result.completed, but a completed turn can lose that
    // event while retaining the final JSON message. Recover that payload before
    // treating the run as a missing-result failure.
    const structuredResult = result === undefined ? parseStructuredOutput(output) : result;
    if (structuredResult === undefined)
      throw new Error("Result validation: structured output finalization produced no result");
    await assertJobActive();
    let parsed: T;
    try {
      parsed = args.schema.parse(structuredResult) as T;
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
        await client().sessions.attach(sessionId).cancel();
      } catch (cancelError) {
        console.error("Failed to cancel timed-out Eve session", cancelError);
      }
    }
    await db
      .update(runs)
      .set({
        status: "failed",
        error: String(error),
        output: output || (restart ? null : saved?.output),
        finishedAt: new Date(),
      })
      .where(eq(runs.id, id));
    // Eve can occasionally lose the structured result during finalization even
    // though the turn has otherwise completed. Replay that turn once so a
    // transient gateway/runtime omission does not strand the job for manual
    // recovery. The guard keeps persistent failures visible and bounded.
    if (
      String(error).includes("structured output finalization produced no result") &&
      (args.retryFinalization ?? 0) < 2
    )
      // A missing final result is a gateway/runtime race. Start a fresh Eve
      // session for the bounded retry; reattaching the same session can replay
      // the already-corrupted finalization state.
      return agent({
        ...args,
        input: `${args.input}\n\nYour previous attempt completed without delivering its required structured result. Re-run the task and finish by returning the required structured output through final_output. Do not stop after prose or tool activity.`,
        retryFinalization: (args.retryFinalization ?? 0) + 1,
        restart: true,
      });
    throw error;
  } finally {
    if (!reportedSteps && !estimatedSteps) {
      if (modelStarted) {
        inputTokens = Math.ceil(contextChars / 4) + images.length * 1000;
        outputTokens = Math.ceil(Math.max(output.length, stepOutputChars) / 4);
        estimatedSteps++;
        await saveUsage();
      } else if (!saved || restart)
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
