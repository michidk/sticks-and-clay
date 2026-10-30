import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, assetVersions, runs, jobs } from "../db/schema";
import { jobContext } from "./checkpoint.server";
import { executeAssetVersionJob } from "./model-pipeline.server";
import { getStorage } from "./storage.server";
import { workshopSchema, type WorkshopSnapshot } from "./workshop";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const svg = (fill: string, r: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="${r * 24 / 100}" fill="${fill}"/></svg>`;
const verdict = (passed: boolean, summary: string) => ({
  passed,
  score: passed ? 90 : 50,
  summary,
  improvements: passed ? [] : [{ priority: "major", issue: "Too small", action: "Increase r to 36", view: "full" }],
});

async function scenario(judgeIterations: number, saved: { step: string; role: string; iteration: number; result: object }[], workshop?: WorkshopSnapshot) {
  const projectId = crypto.randomUUID(), batchId = crypto.randomUUID(), modelId = crypto.randomUUID(), jobId = crypto.randomUUID();
  await db.insert(projects).values({ id: projectId, name: "Review fixture", description: "test", assetType: "svg", status: "ready" });
  await db.insert(batches).values({ id: batchId, projectId, prompt: "circle", count: 1, judgeIterations, design: "Green circles", designVersion: 1, status: "building", ...(workshop ? { workshop } : {}) });
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
      for (const file of ["graphic.svg", "preview.png", "preview-64.png", "preview-24.png", "preview-16.png", "preview-dark-64.png", "preview-dark-24.png", "preview-dark-16.png"])
        if (await getStorage().exists(`${dir}/${file}`)) await getStorage().delete(`${dir}/${file}`);
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
    await db.delete(batches).where(eq(batches.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  };
  return { base, run, cleanup, batchId, modelId };
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


integration("a contradictory passing review with a major defect finishes with issues on replay", async () => {
  const t = await scenario(1, [
    { step: "svg", role: "svg", iteration: 0, result: { svg: svg("#284e3c", 20) } },
    { step: "judge:0", role: "svg-judge", iteration: 0, result: { ...verdict(false, "Too small"), passed: true, score: 95 } },
  ]);
  try {
    const model = await t.run();
    expect(model.verdict).toBe("limit_reached");
    expect(model.feedback).toMatchObject({ passed: false, score: 95, improvements: [{ priority: "major" }] });
  } finally {
    await t.cleanup();
  }
});

integration("revision review transports labeled current and previous evidence without a paid call", async () => {
  const t = await scenario(2, [
    { step: "svg", role: "svg", iteration: 0, result: { svg: svg("#284e3c", 20) } },
    { step: "judge:0", role: "svg-judge", iteration: 0, result: verdict(false, "Too small") },
    { step: "builder:1", role: "svg", iteration: 1, result: { svg: svg("#284e3c", 36) } },
    { step: "judge:1:reading", role: "svg-reader", iteration: 1, result: { subject: "circle", alternatives: [], visibleFeatures: "round", smallSizeReading: "circle" } },
  ]);
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalBase = process.env.OPENAI_BASE_URL;
  let requestBody = "";
  try {
    process.env.OPENAI_API_KEY = "review-test-fixture";
    process.env.OPENAI_BASE_URL = "https://review.invalid/v1";
    globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = String(init?.body);
      throw new Error("Stopped before provider request");
    }, { preconnect: originalFetch.preconnect });
    await expect(t.run()).rejects.toThrow();
    const [review] = (await db.select().from(runs).where(eq(runs.modelId, t.modelId)))
      .filter((run) => run.role === "svg-judge" && run.iteration === 1);
    expect(review.input).toContain("Image 1: full-size render (768 px) on white (current output)");
    expect(review.input).toContain("Image 8: full-size render (768 px) on white (previous output)");
    const current = await (await getStorage().download(`${t.base}/iteration-1/preview.png`)).arrayBuffer();
    const previous = await (await getStorage().download(`${t.base}/preview.png`)).arrayBuffer();
    const currentIndex = requestBody.indexOf(Buffer.from(current).toString("base64"));
    const previousIndex = requestBody.indexOf(Buffer.from(previous).toString("base64"));
    expect(currentIndex).toBeGreaterThan(-1);
    expect(previousIndex).toBeGreaterThan(currentIndex);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.OPENAI_BASE_URL; else process.env.OPENAI_BASE_URL = originalBase;
    await t.cleanup();
  }
});

integration("non-square SVG completes with a dimension error instead of an unreviewed success", async () => {
  const t = await scenario(0, [{ step: "svg", role: "svg", iteration: 0, result: { svg: svg("#284e3c", 30).replace("0 0 24 24", "0 0 24 20") } }]);
  try {
    const model = await t.run();
    expect(model.status).toBe("done");
    expect(model.verdict).toBe("limit_reached");
    expect(model.feedback).toMatchObject({ passed: false, summary: expect.stringContaining("square viewBox") });
  } finally { await t.cleanup(); }
});

integration.each([
  ["logo", ["preview.png", "preview-64.png", "preview-16.png", "preview-dark-64.png", "preview-dark-16.png"], ["preview-24.png", "preview-dark-24.png"]],
  ["illustration", ["preview.png", "preview-64.png"], ["preview-24.png", "preview-16.png", "preview-dark-64.png"]],
] as const)("%s intent publishes only the previews its review needs", async (svgIntent, kept, skipped) => {
  const t = await scenario(1, [
    { step: "svg", role: "svg", iteration: 0, result: { svg: svg("#284e3c", 36) } },
    { step: "judge:0", role: "svg-judge", iteration: 0, result: verdict(true, "Distinctive mark") },
    // A saved reading is reopened (and rejected as another role's run) only if the review wrongly takes the icon path.
    { step: "judge:0:reading", role: "svg-judge", iteration: 0, result: {} },
  ], { ...workshopSchema.parse({}), svgIntent });
  try {
    const model = await t.run();
    expect(model.status).toBe("done");
    expect(model.verdict).toBe("approved");
    for (const file of kept) expect(await getStorage().exists(`${t.base}/${file}`)).toBe(true);
    for (const file of skipped) expect(await getStorage().exists(`${t.base}/${file}`)).toBe(false);
  } finally {
    await t.cleanup();
  }
});
