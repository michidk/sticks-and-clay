import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, models, runs, jobs } from "../db/schema";
import { jobContext } from "./checkpoint.server";
import { executeModelJob } from "./model-pipeline.server";
import { getStorage } from "./storage.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
// A 4x4 drawing; `fill` is the number of cells drawn in the second row.
const drawing = (fill: number) => ({
  plan: "dot", width: 4, height: 4,
  palette: [{ key: ".", color: "transparent" }, { key: "o", color: "#284e3c" }],
  rows: ["....", "o".repeat(fill).padEnd(4, "."), "....", "...."],
});
const verdict = (passed: boolean, summary: string) => ({
  passed,
  score: passed ? 90 : 50,
  summary,
  improvements: passed ? [] : [{ priority: "major", issue: "Too small", action: "Increase r to 36", view: "full" }],
});

async function scenario(judgeIterations: number, saved: { step: string; role: string; iteration: number; result: object }[]) {
  const projectId = crypto.randomUUID(), batchId = crypto.randomUUID(), modelId = crypto.randomUUID(), jobId = crypto.randomUUID();
  await db.insert(projects).values({ id: projectId, name: "Review fixture", description: "test", assetType: "pixel", status: "ready" });
  await db.insert(batches).values({ id: batchId, projectId, prompt: "circle", count: 1, judgeIterations, design: "Green circles", designVersion: 1, status: "building" });
  await db.insert(models).values({ id: modelId, projectId, batchId, name: "Circle", prompt: "A green circle" });
  const checkpoint: Record<string, string> = {};
  for (const item of saved) {
    const id = crypto.randomUUID();
    checkpoint[`step:${item.step}`] = id;
    await db.insert(runs).values({
      id, projectId, batchId, modelId, role: item.role, engine: "tanstack", status: "done", iteration: item.iteration,
      model: "fixture", promptVersion: "test", systemPrompt: "test", input: "test",
      rates: { input: 0, output: 0, cached: 0, source: "test" }, result: item.result,
    });
  }
  await db.insert(jobs).values({ id: jobId, kind: "model", targetId: modelId, status: "running", checkpoint });
  const base = `graphics/${modelId}/${jobId}`;
  const run = async () => {
    for (let i = 0; i < 2; i++) await jobContext.run({ id: jobId, checkpoint }, () => executeModelJob(modelId));
    const [model] = await db.select().from(models).where(eq(models.id, modelId));
    return model;
  };
  const cleanup = async () => {
    for (const dir of [base, `${base}/iteration-1`])
      for (const file of ["pixel.png", "preview.png", "grid.json"])
        if (await getStorage().exists(`${dir}/${file}`)) await getStorage().delete(`${dir}/${file}`);
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(models).where(eq(models.projectId, projectId));
    await db.delete(batches).where(eq(batches.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  };
  return { base, run, cleanup, batchId };
}

integration("pixel art is drawn on a grid, rendered exactly, and revised after a failed review", async () => {
  const t = await scenario(2, [
    { step: "pixel", role: "pixel", iteration: 0, result: drawing(1) },
    { step: "judge:0", role: "pixel-judge", iteration: 0, result: verdict(false, "Too small") },
    { step: "builder:1", role: "pixel", iteration: 1, result: drawing(3) },
    { step: "judge:1", role: "pixel-judge", iteration: 1, result: verdict(true, "Good size now") },
  ]);
  try {
    const model = await t.run();
    expect(model.verdict).toBe("approved");
    expect(model.artifacts).toEqual({ image: `${t.base}/iteration-1/pixel.png`, stage: "final", format: "pixel" });
    expect(await getStorage().exists(`${t.base}/pixel.png`)).toBe(true);
    expect(await getStorage().exists(`${t.base}/iteration-1/preview.png`)).toBe(true);
    const grid = JSON.parse(await (await getStorage().download(`${t.base}/iteration-1/grid.json`)).text());
    expect(grid.rows[1]).toBe("ooo.");
  } finally {
    await t.cleanup();
  }
});

integration("a drawing that does not fit its grid fails the version with the first problem named", async () => {
  const t = await scenario(0, [{ step: "pixel", role: "pixel", iteration: 0, result: { ...drawing(1), rows: ["....", "o...", "....", "....", "...."] } }]);
  try {
    await expect(t.run()).rejects.toThrow("Expected 4 rows, got 5");
  } finally {
    await t.cleanup();
  }
});
