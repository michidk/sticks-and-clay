import { expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { assetEntries, assetVersions, batches, jobs, projects, runs } from "../db/schema";
import { api } from "./api.server";
import { jobContext } from "./checkpoint.server";
import { executeJob, failJob } from "./pipeline.server";
import { cancelJob } from "./queue.server";
import { returnVersionToIdea } from "./assets.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

async function fixture() {
  const projectId = crypto.randomUUID(), batchId = crypto.randomUUID(), jobId = crypto.randomUUID(), runId = crypto.randomUUID();
  await db.insert(projects).values({ id: projectId, name: "Planning fixture", description: "test", status: "ready", assetType: "svg" });
  await db.insert(batches).values({ id: batchId, projectId, prompt: "Two wall switches", count: 2, judgeIterations: 0, design: "Green switches", designVersion: 1 });
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of ids) await db.insert(assetVersions).values({ id, projectId, batchId, name: "Switch", prompt: "Wall switch" });
  const checkpoint = { "direct:svg-planner": runId, "planner-references": "[]" };
  await db.insert(runs).values({ id: runId, projectId, batchId, role: "svg-planner", engine: "tanstack", status: "done", model: "fixture",
    promptVersion: "test", systemPrompt: "test", input: "test", rates: { input: 0, output: 0, cached: 0, source: "test" },
    result: { models: [{ name: "First switch", prompt: "First planned switch" }, { name: "Second switch", prompt: "Second planned switch" }] } });
  await db.insert(jobs).values({ id: jobId, kind: "plan", targetId: batchId, status: "queued", checkpoint });
  const cleanup = async () => {
    await db.delete(jobs).where(inArray(jobs.targetId, [batchId, ...ids]));
    await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
    await db.delete(assetEntries).where(eq(assetEntries.projectId, projectId));
    await db.delete(batches).where(eq(batches.id, batchId));
    await db.delete(projects).where(eq(projects.id, projectId));
  };
  return { projectId, batchId, jobId, runId, ids, checkpoint, cleanup };
}

integration("cancelling an unplanned asset marks its reserved versions terminal and retains its identity in Ideas", async () => {
  const t = await fixture();
  try {
    expect(await cancelJob(t.jobId, true)).toBe("cancelled");
    const versions = await db.select().from(assetVersions).where(eq(assetVersions.batchId, t.batchId));
    expect(versions.map((version) => version.status)).toEqual(["cancelled", "cancelled"]);
    const returned = await returnVersionToIdea(t.ids[0], false);
    const version = versions.find((item) => item.id === t.ids[0]);
    if (!version) throw new Error("Missing reserved version");
    expect(returned.id).toBe(version.assetId);
    expect((await db.select().from(assetEntries).where(eq(assetEntries.id, returned.id)))[0].inIdea).toBe(true);
    expect(await db.select().from(jobs).where(eq(jobs.kind, "model"))).not.toContainEqual(expect.objectContaining({ targetId: t.ids[0] }));
  } finally { await t.cleanup(); }
});

integration.each(["version", "batch"])("retrying failed planning through the %s resumes the saved planner before building", async (via) => {
  const t = await fixture();
  try {
    await db.update(jobs).set({ status: "failed", error: "Planner interrupted" }).where(eq(jobs.id, t.jobId));
    await failJob("plan", t.batchId, "Planner interrupted");
    expect((await db.select().from(assetVersions).where(eq(assetVersions.batchId, t.batchId))).map((version) => version.status))
      .toEqual(["failed", "failed"]);
    const path = via === "version" ? `models/${t.ids[0]}/retry` : `batches/${t.batchId}/resume`;
    const response = await api(new Request(`http://localhost/api/${path}`, { method: "POST" }));
    expect(await response.json()).toEqual({ ok: true });
    const [planner] = await db.select().from(jobs).where(eq(jobs.id, t.jobId));
    expect(planner).toMatchObject({ status: "queued", checkpoint: t.checkpoint });
    expect(await db.select().from(jobs).where(and(eq(jobs.kind, "model"), inArray(jobs.targetId, t.ids)))).toHaveLength(0);
    expect((await db.select().from(assetVersions).where(eq(assetVersions.batchId, t.batchId))).map((version) => version.status))
      .toEqual(["queued", "queued"]);
    await jobContext.run({ id: t.jobId, checkpoint: planner.checkpoint }, () => executeJob("plan", t.batchId));
    const versions = await db.select().from(assetVersions).where(eq(assetVersions.batchId, t.batchId));
    expect(versions).toHaveLength(2);
    expect(versions.map((version) => version.prompt).sort()).toEqual(["First planned switch", "Second planned switch"]);
    expect(versions.every((version) => version.status === "queued")).toBe(true);
    expect(await db.select().from(jobs).where(and(eq(jobs.kind, "model"), inArray(jobs.targetId, t.ids)))).toHaveLength(2);
    const [saved] = await db.select().from(jobs).where(eq(jobs.id, t.jobId));
    expect(saved.checkpoint).toEqual({ ...t.checkpoint, applied: "yes" });
  } finally { await t.cleanup(); }
});

integration("planner failure and cancellation leave versions with their own durable jobs untouched", async () => {
  const t = await fixture();
  try {
    await db.update(assetVersions).set({ status: "building", phase: "Existing build" }).where(eq(assetVersions.id, t.ids[0]));
    await db.insert(jobs).values({ id: crypto.randomUUID(), kind: "model", targetId: t.ids[0], status: "running" });
    await failJob("plan", t.batchId, "Planner interrupted");
    const states = async () => (await db.select().from(assetVersions).where(eq(assetVersions.batchId, t.batchId)))
      .map((version) => ({ id: version.id, status: version.status }));
    expect(await states()).toContainEqual({ id: t.ids[0], status: "building" });
    expect(await states()).toContainEqual({ id: t.ids[1], status: "failed" });
    await cancelJob(t.jobId, true);
    expect(await states()).toContainEqual({ id: t.ids[0], status: "building" });
    expect(await states()).toContainEqual({ id: t.ids[1], status: "cancelled" });
  } finally { await t.cleanup(); }
});
