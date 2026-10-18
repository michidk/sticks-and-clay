import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { assetEntries, assetVersions, batches, jobs, projects, runs } from "../db/schema";
import { executeAssetVersionJob } from "./model-pipeline.server";
import { jobContext } from "./checkpoint.server";
import { getStorage } from "./storage.server";

const integration = process.env.TEST_DATABASE === "1" && process.env.TEST_CAD === "1" ? test : test.skip;
const script = (width: number) => `import cadquery as cq\nresult = cq.Workplane("XY").box(${width},30,10).faces(">Z").workplane().hole(6)\nshow_object(result, options={"name":"body"})\n`;
const verdict = { passed: true, score: 95, summary: "Looks good", improvements: [] };

integration("CAD builds, measures and photographs real geometry; required checks override a visual pass and resume reuses artifacts", async () => {
  const projectId = crypto.randomUUID(), batchId = crypto.randomUUID(), modelId = crypto.randomUUID(), jobId = crypto.randomUUID();
  const checkpoint: Record<string, string> = {};
  await db.insert(projects).values({ id: projectId, name: "CAD fixture", description: "test", assetType: "cad", status: "ready" });
  await db.insert(batches).values({ id: batchId, projectId, prompt: "42 mm bracket", count: 1, judgeIterations: 2, design: "42×30×10 mm, one 6 mm bore", designVersion: 1, status: "building" });
  await db.insert(assetVersions).values({ id: modelId, projectId, batchId, name: "Bracket", prompt: "42 mm wide bracket" });
  for (const fixture of [
    { step: "cad:spec", role: "cad-spec", iteration: 0, result: { plan: "Bracket", assumptions: [], requirements: [{ name: "width", kind: "x", value: 42, tolerance: .01, required: true }] } },
    { step: "cad", role: "cad", iteration: 0, result: { script: 'raise ValueError("broken feature")', notes: "Bad first source" } },
    { step: "cad:fix1", role: "cad", iteration: 0, result: { script: script(40), notes: "First candidate" } },
    { step: "builder:1", role: "cad", iteration: 1, result: { script: script(42), notes: "Correct width" } },
    { step: "judge:0", role: "cad-judge", iteration: 0, result: verdict },
    { step: "judge:1", role: "cad-judge", iteration: 1, result: verdict },
  ]) {
    const id = crypto.randomUUID(); checkpoint[`step:${fixture.step}`] = id;
    await db.insert(runs).values({ id, projectId, batchId, modelId, role: fixture.role, engine: "tanstack", status: "done", iteration: fixture.iteration,
      model: "fixture", promptVersion: "test", systemPrompt: "test", input: "test", result: fixture.result, rates: { input: 0, output: 0, cached: 0, source: "test" } });
  }
  await db.insert(jobs).values({ id: jobId, kind: "model", targetId: modelId, status: "running", checkpoint });
  try {
    const run = () => jobContext.run({ id: jobId, checkpoint }, () => executeAssetVersionJob(modelId));
    await run();
    const [model] = await db.select().from(assetVersions).where(eq(assetVersions.id, modelId));
    expect(model.verdict).toBe("approved"); expect(model.iteration).toBe(1);
    const exports = model.artifacts!.exports as Record<string, string>;
    const metrics = JSON.parse(await (await getStorage().download(exports.metrics)).text());
    expect(metrics.dimensionsMm.x).toBeCloseTo(42);
    expect(metrics.checks[0].state).toBe("passed");
    const before = await (await getStorage().download(exports.step)).arrayBuffer();
    delete checkpoint["cad:candidate:builder:1"];
    await run();
    expect(await (await getStorage().download(exports.step)).arrayBuffer()).toEqual(before);
    expect(Buffer.from(await (await getStorage().download(exports.source)).arrayBuffer()).includes(Buffer.from("cadcore.py"))).toBe(true);
    const [saved] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(saved.checkpoint["cad:candidate:builder:0"]).toBeDefined();
    expect(saved.checkpoint["cad:failure:builder:0:0"]).toBeDefined();
    expect((await db.select().from(runs).where(eq(runs.modelId, modelId))).length).toBe(6);
  } finally {
    for (const key of await getStorage().list(`cad/${modelId}/`)) await getStorage().delete(key);
    await db.delete(jobs).where(eq(jobs.id, jobId)); await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId)); await db.delete(assetEntries).where(eq(assetEntries.projectId, projectId));
    await db.delete(batches).where(eq(batches.id, batchId)); await db.delete(projects).where(eq(projects.id, projectId));
  }
}, 300_000);
