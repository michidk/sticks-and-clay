import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, assetVersions, runs, jobs } from "../db/schema";
import { jobContext } from "./checkpoint.server";
import { executeAssetVersionJob } from "./model-pipeline.server";
import { getStorage } from "./storage.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const svg = (fill: string, r: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="${r}" fill="${fill}"/></svg>`;
const verdict = (passed: boolean, summary: string) => ({
  passed,
  score: passed ? 90 : 50,
  summary,
  improvements: passed ? [] : [{ priority: "major", issue: "Too small", action: "Increase r to 36", view: "full" }],
});

async function scenario(judgeIterations: number, saved: { step: string; role: string; iteration: number; result: object }[]) {
  const projectId = crypto.randomUUID(), batchId = crypto.randomUUID(), modelId = crypto.randomUUID(), jobId = crypto.randomUUID();
  await db.insert(projects).values({ id: projectId, name: "Review fixture", description: "test", assetType: "svg", status: "ready" });
  await db.insert(batches).values({ id: batchId, projectId, prompt: "circle", count: 1, judgeIterations, design: "Green circles", designVersion: 1, status: "building" });
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
    for (let i = 0; i < 2; i++) await jobContext.run({ id: jobId, checkpoint }, () => executeAssetVersionJob(modelId));
    const [model] = await db.select().from(assetVersions).where(eq(assetVersions.id, modelId));
    return model;
  };
  const cleanup = async () => {
    for (const dir of [base, `${base}/iteration-1`])
      for (const file of ["graphic.svg", "preview.png", "preview-64.png"])
        if (await getStorage().exists(`${dir}/${file}`)) await getStorage().delete(`${dir}/${file}`);
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
    await db.delete(batches).where(eq(batches.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  };
  return { base, run, cleanup, batchId };
}

integration("a failed review triggers a revision that is reviewed again and approved", async () => {
  const t = await scenario(2, [
    { step: "svg", role: "svg", iteration: 0, result: { svg: svg("#284e3c", 20) } },
    { step: "judge:0", role: "svg-judge", iteration: 0, result: verdict(false, "Circle is too small") },
    { step: "builder:1", role: "svg", iteration: 1, result: { svg: svg("#284e3c", 36) } },
    { step: "judge:1", role: "svg-judge", iteration: 1, result: verdict(true, "Good size now") },
  ]);
  try {
    const model = await t.run();
    expect(model.status).toBe("done");
    expect(model.verdict).toBe("approved");
    expect(model.artifacts).toEqual({ image: `${t.base}/iteration-1/graphic.svg`, stage: "final", format: "svg" });
    expect((model.feedback as { summary: string }).summary).toBe("Good size now");
    expect(await getStorage().exists(`${t.base}/graphic.svg`)).toBe(true);
    expect(await getStorage().exists(`${t.base}/iteration-1/preview-64.png`)).toBe(true);
  } finally {
    await t.cleanup();
  }
});

integration("exhausted review rounds finish with issues rather than approval", async () => {
  const t = await scenario(1, [
    { step: "svg", role: "svg", iteration: 0, result: { svg: svg("#284e3c", 20) } },
    { step: "judge:0", role: "svg-judge", iteration: 0, result: verdict(false, "Still too small") },
  ]);
  try {
    const model = await t.run();
    expect(model.status).toBe("done");
    expect(model.verdict).toBe("limit_reached");
    expect(model.artifacts).toMatchObject({ image: `${t.base}/graphic.svg` });
  } finally {
    await t.cleanup();
  }
});
