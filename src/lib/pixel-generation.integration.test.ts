import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, assetVersions, runs, jobs } from "../db/schema";
import { jobContext } from "./checkpoint.server";
import { executeAssetVersionJob } from "./model-pipeline.server";
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

// `passes` > 1 replays the finished job to prove resume is idempotent; a retried drawing leaves a failed run, so retries run once.
async function scenario(judgeIterations: number, saved: { step: string; role: string; iteration: number; result: object }[], passes = 2, design = "Green circles") {
  const projectId = crypto.randomUUID(), batchId = crypto.randomUUID(), modelId = crypto.randomUUID(), jobId = crypto.randomUUID();
  await db.insert(projects).values({ id: projectId, name: "Review fixture", description: "test", assetType: "pixel", status: "ready" });
  await db.insert(batches).values({ id: batchId, projectId, prompt: "circle", count: 1, judgeIterations, design, designVersion: 1, status: "building" });
  await db.insert(assetVersions).values({ id: modelId, projectId, batchId, name: "Circle", prompt: "A green circle" });
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
    for (let i = 0; i < passes; i++) await jobContext.run({ id: jobId, checkpoint }, () => executeAssetVersionJob(modelId));
    const [model] = await db.select().from(assetVersions).where(eq(assetVersions.id, modelId));
    return model;
  };
  const cleanup = async () => {
    for (const dir of [base, `${base}/iteration-1`])
      for (const file of ["pixel.png", "preview.png", "review.png", "grid.json", "sheet.png", "sheet.json", "sheet.unity.json", "sheet.godot.json", "anim.gif"])
        if (await getStorage().exists(`${dir}/${file}`)) await getStorage().delete(`${dir}/${file}`);
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
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
    const dir = `${t.base}/iteration-1`;
    expect(model.artifacts).toEqual({
      image: `${dir}/pixel.png`, stage: "final", format: "pixel",
      exports: { sheet: `${dir}/sheet.png`, sheetLayout: `${dir}/sheet.json`, unity: `${dir}/sheet.unity.json`, godot: `${dir}/sheet.godot.json` },
    });
    expect(await getStorage().exists(`${t.base}/pixel.png`)).toBe(true);
    expect(await getStorage().exists(`${dir}/preview.png`)).toBe(true);
    expect(await getStorage().exists(`${dir}/review.png`)).toBe(true);
    const grid = JSON.parse(await (await getStorage().download(`${dir}/grid.json`)).text());
    expect(grid).toMatchObject({ version: 2, rows: ["....", "ooo.", "....", "...."] });
    // The judge and the reviser see the review sheet; the run records the measurements behind it.
    const builds = (await db.select().from(runs).where(eq(runs.modelId, model.id))).filter((run) => run.role === "pixel");
    const latest = builds.find((run) => run.iteration === 1)!.result as { review: string; analysis: { craft: object; warnings: string[] } };
    expect(latest.review).toBe(`${dir}/review.png`);
    expect(latest.analysis.craft).toHaveProperty("valueRange");
    expect(latest.analysis.warnings.some((w) => w.startsWith("GRID:"))).toBe(true);
  } finally {
    await t.cleanup();
  }
});

integration("a revision may return patches against the previous drawing", async () => {
  const t = await scenario(2, [
    { step: "pixel", role: "pixel", iteration: 0, result: drawing(1) },
    { step: "judge:0", role: "pixel-judge", iteration: 0, result: verdict(false, "Too small") },
    { step: "builder:1", role: "pixel", iteration: 1, result: { plan: "widen", width: 4, height: 4, palette: drawing(1).palette, patches: [{ row: 2, column: 2, rows: ["oo"] }] } },
    { step: "judge:1", role: "pixel-judge", iteration: 1, result: verdict(true, "Good size now") },
  ]);
  try {
    expect((await t.run()).verdict).toBe("approved");
    const grid = JSON.parse(await (await getStorage().download(`${t.base}/iteration-1/grid.json`)).text());
    expect(grid.rows).toEqual(["....", "ooo.", "....", "...."]);
    expect(grid.patches).toBeUndefined();
  } finally {
    await t.cleanup();
  }
});

const offPalette = { ...drawing(2), palette: [{ key: ".", color: "transparent" }, { key: "o", color: "#284e3c" }] };
const onPalette = { ...drawing(2), palette: [{ key: ".", color: "transparent" }, { key: "o", color: "#306230" }] };

integration("a drawing outside the named palette is retried with the colors named", async () => {
  const t = await scenario(0, [
    { step: "pixel", role: "pixel", iteration: 0, result: offPalette },
    { step: "pixel:fix1", role: "pixel", iteration: 0, result: onPalette },
  ], 1, "Game Boy palette, 16x16 icons");
  try {
    expect((await t.run()).status).toBe("done");
    const failed = (await db.select().from(runs).where(eq(runs.batchId, t.batchId))).filter((run) => run.status === "failed");
    expect(failed[0].error).toContain('"o" #284e3c (nearest');
    const grid = JSON.parse(await (await getStorage().download(`${t.base}/grid.json`)).text());
    expect(grid.palette[1].color).toBe("#306230");
  } finally {
    await t.cleanup();
  }
});

integration("a corrected drawing that still leaves the named palette is snapped and the change recorded", async () => {
  const t = await scenario(0, [
    { step: "pixel", role: "pixel", iteration: 0, result: offPalette },
    { step: "pixel:fix1", role: "pixel", iteration: 0, result: offPalette },
  ], 1, "Game Boy palette, 16x16 icons");
  try {
    expect((await t.run()).status).toBe("done");
    const grid = JSON.parse(await (await getStorage().download(`${t.base}/grid.json`)).text());
    expect(["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]).toContain(grid.palette[1].color);
    const fixed = (await db.select().from(runs).where(eq(runs.batchId, t.batchId))).find((run) => run.status === "done" && run.role === "pixel");
    expect((fixed!.result as { analysis: { snappedToNamedPalette: object[] } }).analysis.snappedToNamedPalette).toEqual([
      { key: "o", from: "#284e3c", to: grid.palette[1].color },
    ]);
  } finally {
    await t.cleanup();
  }
});

const tooManyRows = { ...drawing(1), rows: ["....", "o...", "....", "....", "...."] };

integration("a drawing that does not fit its grid is retried once with the problem named, then accepted", async () => {
  const t = await scenario(0, [
    { step: "pixel", role: "pixel", iteration: 0, result: tooManyRows },
    { step: "pixel:fix1", role: "pixel", iteration: 0, result: drawing(2) },
  ], 1);
  try {
    const model = await t.run();
    expect(model.status).toBe("done");
    const grid = JSON.parse(await (await getStorage().download(`${t.base}/grid.json`)).text());
    expect(grid.rows[1]).toBe("oo..");
    const failed = (await db.select().from(runs).where(eq(runs.modelId, model.id))).filter((run) => run.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].error).toContain("Expected 4 rows, got 5");
  } finally {
    await t.cleanup();
  }
});

integration("a drawing that is wrong twice fails the version with the first problem named", async () => {
  const t = await scenario(0, [
    { step: "pixel", role: "pixel", iteration: 0, result: tooManyRows },
    { step: "pixel:fix1", role: "pixel", iteration: 0, result: { ...drawing(1), rows: ["....", "o..", "....", "...."] } },
  ], 1);
  try {
    await expect(t.run()).rejects.toThrow("Row 2 has 3 cells; expected 4");
  } finally {
    await t.cleanup();
  }
});
