import { expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { assetEntries, assetVersions, batches, jobs, projects, runs } from "../db/schema";
import { api } from "./api.server";
import { jobContext } from "./checkpoint.server";
import { executeJob, failJob } from "./pipeline.server";
import { cancelJob } from "./queue.server";
import { reopenVersionAsIdea } from "./assets.server";

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

integration("cancelling an unplanned asset marks its reserved versions terminal and can be reopened as a new idea", async () => {
  const t = await fixture();
  try {
    expect(await cancelJob(t.jobId, true)).toBe("cancelled");
    const versions = await db.select().from(assetVersions).where(eq(assetVersions.batchId, t.batchId));
    expect(versions.map((version) => version.status)).toEqual(["cancelled", "cancelled"]);
    const returned = await reopenVersionAsIdea(t.ids[0]);
    const version = versions.find((item) => item.id === t.ids[0]);
    if (!version) throw new Error("Missing reserved version");
    expect(returned.id).not.toBe(version.assetId);
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

integration("the planner names the assets of a multi-asset request, but an idea keeps the title it was given", async () => {
  const projectId = crypto.randomUUID();
  await db.insert(projects).values({ id: projectId, name: "Naming fixture", description: "test", status: "ready", assetType: "svg", design: "Green switches", designVersion: 1 });
  const plan = async (batchId: string, names: string[]) => {
    const runId = crypto.randomUUID();
    await db.insert(runs).values({ id: runId, projectId, batchId, role: "svg-planner", engine: "tanstack", status: "done", model: "fixture",
      promptVersion: "test", systemPrompt: "test", input: "test", rates: { input: 0, output: 0, cached: 0, source: "test" },
      result: { models: names.map((name) => ({ name, prompt: `Planned brief for the ${name}` })) } });
    const [job] = await db.select().from(jobs).where(and(eq(jobs.kind, "plan"), eq(jobs.targetId, batchId)));
    const checkpoint = { "direct:svg-planner": runId, "planner-references": "[]" };
    await jobContext.run({ id: job.id, checkpoint }, () => executeJob("plan", batchId));
  };
  try {
    const { queueGeneration, } = await import("./generation.server");
    const { createAsset, startAsset } = await import("./assets.server");
    const request = await queueGeneration(projectId, { prompt: "Two wall switches: a light switch and a fan switch", count: 2, judgeIterations: 0, imageSize: "1024x1024" } as never);
    await plan(request, ["Light switch", "Fan switch"]);
    const versions = await db.select().from(assetVersions).where(eq(assetVersions.batchId, request));
    expect(versions.map((v) => v.name).sort()).toEqual(["Fan switch", "Light switch"]);
    const assets = await db.select().from(assetEntries).where(eq(assetEntries.batchId, request));
    expect(assets.map((a) => a.title).sort()).toEqual(["Fan switch", "Light switch"]);
    expect(assets.map((a) => a.input.prompt).sort()).toEqual(["Planned brief for the Fan switch", "Planned brief for the Light switch"]);

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    const idea = await createAsset(project, { title: "Hallway dimmer", prompt: "A dimmer switch", count: 1, judgeIterations: 0, imageSize: "1024x1024" } as never, async () => "unused");
    const started = await startAsset(projectId, idea.id);
    await plan(started, ["Rotary dimmer"]);
    expect((await db.select().from(assetVersions).where(eq(assetVersions.batchId, started)))[0].name).toBe("Hallway dimmer");
    expect((await db.select().from(assetEntries).where(eq(assetEntries.id, idea.id)))[0].title).toBe("Hallway dimmer");

    const untitled = await createAsset(project, { title: "", prompt: "", count: 1, judgeIterations: 0, imageSize: "1024x1024" } as never, async () => "unused");
    const startedUntitled = await startAsset(projectId, untitled.id);
    await plan(startedUntitled, ["Toggle switch"]);
    expect((await db.select().from(assetVersions).where(eq(assetVersions.batchId, startedUntitled)))[0].name).toBe("Toggle switch");
    expect((await db.select().from(assetEntries).where(eq(assetEntries.id, untitled.id)))[0].title).toBe("Toggle switch");
  } finally {
    const batchIds = (await db.select({ id: batches.id }).from(batches).where(eq(batches.projectId, projectId))).map((b) => b.id);
    const versionIds = (await db.select({ id: assetVersions.id }).from(assetVersions).where(eq(assetVersions.projectId, projectId))).map((v) => v.id);
    await db.delete(jobs).where(inArray(jobs.targetId, [...batchIds, ...versionIds, "none"]));
    await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
    await db.delete(assetEntries).where(eq(assetEntries.projectId, projectId));
    await db.delete(batches).where(eq(batches.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
});

integration("one saved SVG construction contract reaches every planned asset unchanged", async () => {
  const t = await fixture();
  const contract = 'viewBox="0 0 24 24"; stroke-width=2; radius=2; ink bounds=2..22; palette=#285C45,#D9A448';
  try {
    await db.update(runs).set({ result: { iconContract: contract, models: [
      { name: "First", prompt: "First planned switch" },
      { name: "Second", prompt: "Second planned switch" },
    ] } }).where(eq(runs.id, t.runId));
    await jobContext.run({ id: t.jobId, checkpoint: t.checkpoint }, () => executeJob("plan", t.batchId));
    const versions = await db.select().from(assetVersions).where(eq(assetVersions.batchId, t.batchId));
    expect(versions.map((v) => v.prompt).sort()).toEqual(["First planned switch", "Second planned switch"].map((brief) =>
      `${brief}\n\nSHARED ICON CONSTRUCTION\n${contract}\nThe approved design and explicit user requirements take precedence.`));
    expect((await db.select().from(batches).where(eq(batches.id, t.batchId)))[0].design).toBe("Green switches");
  } finally { await t.cleanup(); }
});
