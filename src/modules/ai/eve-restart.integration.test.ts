import { expect, spyOn, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { events, jobs, projects, runs } from "../../db/schema";
import { jobContext } from "../../lib/checkpoint.server";
import { runRole } from "./index.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

for (const failure of ["session.failed", "turn.failed", "snapshot-rejected", "expired-legacy-judge", "failed-legacy-judge", "stale-running-legacy-judge", "legacy-cancel-rejected"]) {
  integration(`${failure} recovery preserves history and replaces only unusable sessions`, async () => {
    const projectId = crypto.randomUUID(), jobId = crypto.randomUUID(), oldRunId = crypto.randomUUID();
    const requests: string[] = [];
    const role = ["expired-legacy-judge", "failed-legacy-judge", "stale-running-legacy-judge", "legacy-cancel-rejected"].includes(failure) ? "judge" : "photographer";
    const result = role === "judge"
      ? { passed: true, score: 90, summary: "Reviewed supplied evidence", improvements: [] }
      : { summary: "Photographed", limitations: [] };
    const previousTimeout = process.env.AGENT_TIMEOUT_MS;
    const timeout = AbortSignal.timeout;
    const timeoutSpy = role === "judge" ? spyOn(AbortSignal, "timeout").mockImplementation(
      ms => timeout(ms === 60_000 ? 250 : ms),
    ) : undefined;
    if (role === "judge") process.env.AGENT_TIMEOUT_MS = "60000";
    const event = (type: string, data: unknown, id: string) => ({
      type, data, meta: { id, at: "2026-10-12T09:26:27.000Z", deliveryIds: ["delivery"] },
    });
    const oldHistory = role === "judge" ? [
      event("turn.started", { turnId: "turn_0", sequence: 0 }, "old-start"),
      event("action.result", {
        turnId: "turn_0", sequence: 0, stepIndex: 0, status: "failed",
        result: { kind: "tool-result", callId: "obsolete", toolName: "blender__get_scene_info", output: "Error executing tool get_scene_info", isError: true },
      }, "old-tool"),
      event("step.completed", { turnId: "turn_0", sequence: 0, stepIndex: 0, usage: { inputTokens: 123, outputTokens: 45 } }, "old-usage"),
    ] : [event(failure, { message: "Docker sandbox session container old-container no longer exists." }, "failed")];
    const newHistory = [
      event("turn.started", { turnId: "turn_0", sequence: 0 }, "started"),
      event("step.started", { modelId: "fixture" }, "step"),
      event("step.completed", { usage: { inputTokens: 100, outputTokens: 20 } }, "usage"),
      event("result.completed", { result }, "result"),
      event("turn.completed", { turnId: "turn_0", sequence: 0 }, "completed"),
    ];
    let sent = false;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/eve/v1/session/old-session/cancel" && failure === "legacy-cancel-rejected")
        return new Response("Cancellation unavailable", { status: 400 });
      if (url.pathname === "/eve/v1/session/old-session/cancel")
        return Response.json({ ok: true, status: "accepted", sessionId: "old-session" });
      if (failure === "snapshot-rejected" && url.pathname.includes("old-session"))
        return new Response("Eve unavailable", { status: 400 });
      if (request.method === "POST" && url.pathname === "/eve/v1/session")
        return Response.json({ sessionId: "fresh-session" });
      if (request.method === "POST" && url.pathname === "/eve/v1/session/fresh-session") {
        const body = await request.json();
        expect(body.message[0].text).toContain("saved input");
        sent = true;
        return Response.json({ sessionId: "fresh-session", deliveryId: "delivery" });
      }
      if (request.method !== "GET" || !url.pathname.endsWith("/stream"))
        return new Response("Unexpected request", { status: 400 });
      const history = url.pathname.includes("old-session")
        ? role === "judge" && !url.searchParams.has("includeTailIndex") ? [] : oldHistory
        : sent ? newHistory : [];
      return new Response(history.map(e => JSON.stringify(e) + "\n").join(""), {
        headers: { "content-type": "application/x-ndjson", "x-eve-stream-version": "26", "x-eve-stream-tail-index": String(history.length - 1) },
      });
    }});
    const previousUrl = process.env.EVE_URL;
    process.env.EVE_URL = server.url.toString();
    const key = `agent:${role}:0`;
    const context = { id: jobId, checkpoint: { [key]: oldRunId } };
    try {
      await db.insert(projects).values({ id: projectId, name: "Restart fixture", description: "test" });
      await db.insert(jobs).values({ id: jobId, kind: "model", targetId: projectId, status: "running", checkpoint: context.checkpoint });
      await db.insert(runs).values({ id: oldRunId, projectId, role, engine: "eve", status: ["expired-legacy-judge", "stale-running-legacy-judge"].includes(failure) ? "running" : "failed", createdAt: failure === "stale-running-legacy-judge" ? new Date(Date.now() - 120_000) : new Date(), error: role === "judge" ? "TimeoutError: Eve judge timed out" : null, sessionId: "old-session", model: "fixture", effort: "medium", promptVersion: "fixture", systemPrompt: "fixture", input: "saved input", inputTokens: 123, outputTokens: 45, estimatedCost: role === "judge" ? 0.000696 : 0.001, usageSource: "reported", rates: { input: 2, cached: 0.2, output: 10, source: "fixture" } });
      const execute = () => jobContext.run(context, () => runRole({ role, projectId, input: "replacement must use saved input" }));
      if (failure === "snapshot-rejected") {
        await expect(execute()).rejects.toThrow("Eve unavailable");
        const [oldRun] = await db.select().from(runs).where(eq(runs.id, oldRunId));
        expect(oldRun.status).toBe("failed");
        expect(oldRun.estimatedCost).toBe(0.001);
        expect(context.checkpoint[key]).toBe(oldRunId);
        expect(requests).toEqual(["GET /eve/v1/session/old-session/stream"]);
        return;
      }
      if (failure === "legacy-cancel-rejected") {
        await expect(execute()).rejects.toThrow("Cancellation unavailable");
        expect(context.checkpoint[key]).toBe(oldRunId);
        expect(requests).not.toContain("POST /eve/v1/session");
        return;
      }
      const outcome = await execute();
      expect(outcome.result).toEqual(result);
      expect(outcome.runId).not.toBe(oldRunId);
      const count = requests.length;
      expect(await execute()).toEqual(outcome);
      expect(requests).toHaveLength(count);
      expect(requests.some(r => r === "POST /eve/v1/session/old-session")).toBe(false);
      const [oldRun] = await db.select().from(runs).where(eq(runs.id, oldRunId));
      expect(oldRun.status).toBe("failed");
      expect(oldRun.sessionId).toBe("old-session");
      expect(oldRun.inputTokens).toBe(123);
      expect(oldRun.estimatedCost).toBe(role === "judge" ? 0.000696 : 0.001);
      const [newRun] = await db.select().from(runs).where(eq(runs.id, outcome.runId));
      expect(newRun.sessionId).toBe("fresh-session");
      expect(newRun.inputTokens).toBe(100);
      expect(newRun.outputTokens).toBe(20);
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      expect(job.checkpoint[key]).toBe(outcome.runId);
      if (role === "judge") {
        expect(requests.filter(r => r === "POST /eve/v1/session/old-session/cancel")).toHaveLength(1);
        expect(requests.filter(r => r === "POST /eve/v1/session")).toHaveLength(1);
        expect(oldRun.error).toContain("Eve judge timed out");
      }
    } finally {
      timeoutSpy?.mockRestore();
      if (previousTimeout === undefined) delete process.env.AGENT_TIMEOUT_MS;
      else process.env.AGENT_TIMEOUT_MS = previousTimeout;
      if (previousUrl === undefined) delete process.env.EVE_URL;
      else process.env.EVE_URL = previousUrl;
      await server.stop(true);
      const fixtureRuns = await db.select({ id: runs.id }).from(runs).where(eq(runs.projectId, projectId));
      if (fixtureRuns.length) await db.delete(events).where(inArray(events.runId, fixtureRuns.map(r => r.id)));
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  });
}
