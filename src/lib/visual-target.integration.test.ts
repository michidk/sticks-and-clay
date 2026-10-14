import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { DATA } from "./storage.server";
import { expect, test, spyOn } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { batches, events, jobs, models, projects, runs } from "../db/schema";
import { api } from "./api.server";
import { jobContext } from "./checkpoint.server";
import { prepareVisualTarget } from "./visual-target.server";
import { cancelJob, deferInterruptedJob, JobWaiting } from "./queue.server";
import { settleBatch } from "./batch-state.server";
import { queueGeneration } from "./generation.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
async function fixture(mode: "review" | "skip" | "auto", body: (ids: { p: string; b: string; m: string; j: string }) => Promise<void>) {
  const p = crypto.randomUUID(), b = crypto.randomUUID(), m = crypto.randomUUID(), j = crypto.randomUUID();
  await db.insert(projects).values({ id: p, name: "Target review fixture", description: "test", status: "ready", design: "Approved design", designVersion: 1 });
  await db.insert(batches).values({ id: b, projectId: p, prompt: "test", count: 1, judgeIterations: 0, design: "Approved design", designVersion: 1, status: "building", visualTargetMode: mode });
  await db.insert(models).values({ id: m, projectId: p, batchId: b, name: "fixture", prompt: "test" });
  await db.insert(jobs).values({ id: j, kind: "model", targetId: m, status: "running", checkpoint: { "visual-target": "models/original.png" } });
  try { await body({ p, b, m, j }); }
  finally {
    await db.delete(events).where(inArray(events.runId, db.select({ id: runs.id }).from(runs).where(eq(runs.projectId, p))));
    await db.delete(runs).where(eq(runs.projectId, p));
    await rm(resolve(DATA, "models", m), { recursive: true, force: true });
    await db.delete(jobs).where(eq(jobs.id, j));
    await db.delete(models).where(eq(models.id, m));
    const allBatches = await db.select().from(batches).where(eq(batches.projectId, p));
    for (const batch of allBatches) await db.delete(jobs).where(eq(jobs.targetId, batch.id));
    await db.delete(batches).where(eq(batches.projectId, p));
    await db.delete(projects).where(eq(projects.id, p));
  }
}
async function prepare(id: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
  const [model] = await db.select().from(models).where(eq(models.id, job.targetId));
  const [batch] = await db.select().from(batches).where(eq(batches.id, model.batchId));
  const [project] = await db.select().from(projects).where(eq(projects.id, model.projectId));
  return jobContext.run({ id, checkpoint: job.checkpoint }, () => prepareVisualTarget({ model, batch, project, request: model.prompt, attempt: id, legacy: false }));
}
const decide = (modelId: string, body: unknown) => api(new Request(`http://localhost/api/models/${modelId}/visual-target`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

integration("target approval releases the worker, survives recovery and queues exactly one continuation", () => fixture("review", async ({ p, b, m, j }) => {
  await expect(prepare(j)).rejects.toBeInstanceOf(JobWaiting);
  expect((await db.select().from(jobs).where(eq(jobs.id, j)))[0].status).toBe("waiting");
  expect((await db.select().from(models).where(eq(models.id, m)))[0]).toMatchObject({ status: "awaiting_approval", visualTarget: "models/original.png" });
  expect(await deferInterruptedJob(j)).toHaveLength(0);
  await settleBatch(b);
  expect((await db.select().from(batches).where(eq(batches.id, b)))[0].status).toBe("building");
  expect(await db.select().from(runs).where(eq(runs.projectId, p))).toHaveLength(0);
  expect((await decide(m, { action: "approve", target: "outdated.png" })).status).toBe(400);
  const responses = await Promise.all([decide(m, { action: "approve", target: "models/original.png" }), decide(m, { action: "approve", target: "models/original.png" })]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
  const [queued] = await db.select().from(jobs).where(eq(jobs.id, j));
  expect(queued.status).toBe("queued");
  expect(queued.checkpoint["visual-target-approved"]).toBe("models/original.png");
  await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, j));
  expect((await prepare(j)).target).toBe("models/original.png");
}));

integration("revision keeps previous checkpoints, requires fresh approval and remains cancellable", () => fixture("review", async ({ m, j }) => {
  await expect(prepare(j)).rejects.toBeInstanceOf(JobWaiting);
  expect((await decide(m, { action: "revise", target: "models/original.png", prompt: "Make the canopy wider" })).status).toBe(200);
  const [job] = await db.select().from(jobs).where(eq(jobs.id, j));
  expect(job.checkpoint).toMatchObject({ "visual-target": "models/original.png", "visual-target-revision": "1", "visual-target:1-feedback": "Make the canopy wider" });
  // An image run has finished; resumption must stop at review again without rebuilding.
  await db.update(jobs).set({ status: "running", checkpoint: { ...job.checkpoint, "visual-target:1": "models/revised.png" } }).where(eq(jobs.id, j));
  await expect(prepare(j)).rejects.toBeInstanceOf(JobWaiting);
  expect((await decide(m, { action: "approve", target: "models/original.png" })).status).toBe(400);
  expect(await cancelJob(j)).toBe("cancelled");
  expect((await db.select().from(models).where(eq(models.id, m)))[0].status).toBe("cancelled");
  expect((await decide(m, { action: "approve", target: "models/revised.png" })).status).toBe(400);
}));

integration("skip makes no image call and existing automatic batches do not acquire an approval gate", async () => {
  await fixture("skip", async ({ j }) => {
    await db.update(jobs).set({ checkpoint: {} }).where(eq(jobs.id, j));
    expect(await prepare(j)).toEqual({ target: null, visualReferences: [] });
  });
  await fixture("auto", async ({ j }) => { expect((await prepare(j)).target).toBe("models/original.png"); });
});

integration("new batches snapshot review by default and the explicit skip choice", () => fixture("auto", async ({ p }) => {
  for (const visualTargetMode of [undefined, "skip"] as const) {
    const id = await queueGeneration(p, { prompt: "fixture", count: 1, judgeIterations: 0, imageSize: "1024x1024", visualTargetMode });
    expect((await db.select().from(batches).where(eq(batches.id, id)))[0].visualTargetMode).toBe(visualTargetMode ?? "review");
  }
}));


integration("image revisions use the previous image, retain history and resume without another charge", () => fixture("review", async ({ p, m, j }) => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFcAAAAASUVORK5CYII=";
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "visual-target-test";
  const requests: RequestInit[] = [];
  const fetchMock = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(init || {});
    return Response.json({ data: [{ b64_json: png }], usage: { input_tokens: 12, output_tokens: 24 } });
  }, { preconnect: globalThis.fetch.preconnect });
  const mocked = spyOn(globalThis, "fetch").mockImplementation(fetchMock);
  try {
    await db.update(jobs).set({ checkpoint: {} }).where(eq(jobs.id, j));
    await expect(prepare(j)).rejects.toBeInstanceOf(JobWaiting);
    const [initial] = await db.select().from(models).where(eq(models.id, m));
    expect((await decide(m, { action: "revise", target: initial.visualTarget, prompt: "Widen the canopy" })).status).toBe(200);
    await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, j));
    await expect(prepare(j)).rejects.toBeInstanceOf(JobWaiting);
    const [revised] = await db.select().from(models).where(eq(models.id, m));
    expect(revised.visualTarget).not.toBe(initial.visualTarget);
    expect(requests).toHaveLength(2);
    const edit = requests[1].body;
    expect(edit).toBeInstanceOf(FormData);
    if (!(edit instanceof FormData)) throw new Error("Missing image edit form");
    expect(edit.get("prompt")).toContain("Widen the canopy");
    expect(edit.getAll("image[]")).toHaveLength(1);
    expect(await db.select().from(runs).where(eq(runs.projectId, p))).toHaveLength(2);
    expect((await decide(m, { action: "approve", target: revised.visualTarget })).status).toBe(200);
    await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, j));
    expect((await prepare(j)).target).toBe(revised.visualTarget);
    expect((await prepare(j)).target).toBe(revised.visualTarget);
    expect(requests).toHaveLength(2);
  } finally {
    mocked.mockRestore();
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
}));
