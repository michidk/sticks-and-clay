import { expect, spyOn, test } from "bun:test";
import { ClientSession } from "eve/client";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { events, jobs, projects, runs } from "../../db/schema";
import { jobContext } from "../../lib/checkpoint.server";
import { runRole } from "./index.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

async function withSession(
  check: (fixture: {
    execute: () => Promise<unknown>;
    runId: string;
    sessionId: string;
    requests: { method: string; url: URL }[];
  }) => Promise<void>,
  finish: boolean,
  role: "photographer" | "judge" = "photographer",
) {
  const projectId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const sessionId = "retained-session";
  const result = { summary: "Photographed", limitations: [] };
  const event = (type: string, data: unknown, id: string) => ({
    type,
    data,
    meta: { id, at: "2026-10-12T06:32:11.628Z" },
  });
  const history = [
    event("turn.started", { turnId: "turn_0", sequence: 0 }, "start"),
    event("step.started", { modelId: "fixture" }, "step"),
    event(
      "step.completed",
      { usage: { inputTokens: 100, outputTokens: 20 } },
      "usage",
    ),
  ];
  const requests: { method: string; url: URL }[] = [];
  let liveReads = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push({ method: request.method, url });
      if (url.pathname.endsWith("/cancel"))
        return Response.json({ ok: true, status: "accepted", sessionId });
      if (request.method !== "GET" || !url.pathname.endsWith("/stream"))
        return new Response("Unexpected request", { status: 400 });
      const snapshot = url.searchParams.has("includeTailIndex");
      const messages = snapshot
        ? history
        : finish && ++liveReads === 8
          ? [
              event("result.completed", { result }, "result"),
              event("turn.completed", { turnId: "turn_0", sequence: 0 }, "complete"),
            ]
          : [];
      return new Response(
        messages.map((message) => JSON.stringify(message) + "\n").join(""),
        {
          headers: {
            "content-type": "application/x-ndjson",
            "x-eve-stream-version": "26",
            "x-eve-stream-tail-index": String(history.length - 1),
          },
        },
      );
    },
  });
  const previousUrl = process.env.EVE_URL;
  process.env.EVE_URL = server.url.toString();
  const stream = ClientSession.prototype.stream;
  // Keep the retry limit under test, but skip production backoff delays.
  const streamSpy = spyOn(ClientSession.prototype, "stream").mockImplementation(function (this: ClientSession, options) {
    const policy = options?.streamReconnectPolicy;
    if (policy && "reconnect" in policy) return stream.call(this, options);
    return stream.call(this, {
      ...options,
      streamReconnectPolicy: {
        ...policy,
        streamIdleReconnectPolicy: {
          ...policy?.streamIdleReconnectPolicy,
          baseDelayMs: 1,
          maxDelayMs: 1,
        },
      },
    });
  });
  try {
    await db.insert(projects).values({
      id: projectId,
      name: "Stream recovery fixture",
      description: "test",
    });
    await db.insert(jobs).values({
      id: jobId,
      kind: "model",
      targetId: projectId,
      status: "running",
    });
    await db.insert(runs).values({
      id: runId,
      projectId,
      role,
      engine: "eve",
      status: "running",
      sessionId,
      model: "fixture",
      promptVersion: "fixture",
      systemPrompt: "fixture",
      input: "fixture",
      rates: { input: 2, cached: 0.2, output: 10, source: "fixture" },
    });
    const context = { id: jobId, checkpoint: { [`agent:${role}:0`]: runId } };
    await check({
      execute: () =>
        jobContext.run(context, () =>
          runRole({
            role,
            projectId,
            input: "Must not submit another turn",
          }),
        ),
      runId,
      sessionId,
      requests,
    });
  } finally {
    streamSpy.mockRestore();
    if (previousUrl === undefined) delete process.env.EVE_URL;
    else process.env.EVE_URL = previousUrl;
    await server.stop(true);
    await db.delete(events).where(eq(events.runId, runId));
    await db.delete(runs).where(eq(runs.id, runId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
}

integration("resumed Eve turns survive idle reconnects and replay without duplicate usage", async () => {
  await withSession(async ({ execute, runId, sessionId, requests }) => {
    const expected = { result: { summary: "Photographed", limitations: [] }, runId };
    expect(await execute()).toEqual(expected);
    const requestCount = requests.length;
    expect(requestCount).toBe(9);
    expect(await execute()).toEqual(expected);
    expect(requests).toHaveLength(requestCount);
    expect(requests.every(({ method, url }) => method === "GET" && url.pathname.includes(sessionId))).toBe(true);
    expect(requests.slice(1).every(({ url }) => url.searchParams.get("startIndex") === "3")).toBe(true);
    const [saved] = await db.select().from(runs).where(eq(runs.id, runId));
    expect(saved.status).toBe("done");
    expect(saved.sessionId).toBe(sessionId);
    expect(saved.inputTokens).toBe(100);
    expect(saved.outputTokens).toBe(20);
    expect(saved.estimatedCost).toBeCloseTo(0.0004, 8);
    expect(await db.select().from(events).where(eq(events.runId, runId))).toHaveLength(5);
  }, true);
}, 5_000);

integration("a resumed Eve turn still times out and cancels its retained session", async () => {
  const previousTimeout = process.env.AGENT_TIMEOUT_MS;
  process.env.AGENT_TIMEOUT_MS = "60000";
  const timeout = AbortSignal.timeout;
  // Exercise actual abort handling without waiting for the minimum production timeout.
  const timeoutSpy = spyOn(AbortSignal, "timeout").mockImplementation((ms) =>
    timeout(ms === 60_000 ? 250 : ms),
  );
  try {
    await withSession(async ({ execute, runId, sessionId, requests }) => {
      await expect(execute()).rejects.toMatchObject({ name: "TimeoutError" });
      expect(timeoutSpy).toHaveBeenCalledWith(60_000);
      expect(requests.filter(({ method }) => method === "POST").map(({ url }) => url.pathname)).toEqual([
        `/eve/v1/session/${sessionId}/cancel`,
      ]);
      const [saved] = await db.select().from(runs).where(eq(runs.id, runId));
      expect(saved.status).toBe("failed");
      expect(saved.error).toContain("TimeoutError");
      expect(saved.sessionId).toBe(sessionId);
    }, false, "judge");
  } finally {
    timeoutSpy.mockRestore();
    if (previousTimeout === undefined) delete process.env.AGENT_TIMEOUT_MS;
    else process.env.AGENT_TIMEOUT_MS = previousTimeout;
  }
}, 5_000);
