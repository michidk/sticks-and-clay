import { test, expect } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, assetVersions, runs, jobs } from "../db/schema";
import { jobContext } from "./checkpoint.server";
import { executeAssetVersionJob } from "./model-pipeline.server";
import { getStorage } from "./storage.server";
import { api } from "./api.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
for (const mode of ["unreviewed", "legacy-review", "saved-reading"] as const) integration(
  `SVG resumes ${mode}, publishes vectors and completes without duplicate runs`,
  async () => {
    const projectId = crypto.randomUUID(),
      batchId = crypto.randomUUID(),
      modelId = crypto.randomUUID();
    const runId = crypto.randomUUID(),
      jobId = crypto.randomUUID();
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#284e3c"/></svg>';
    const key = `graphics/${modelId}/${jobId}/graphic.svg`;
    await db
      .insert(projects)
      .values({
        id: projectId,
        name: "SVG fixture",
        description: "test",
        assetType: "svg",
        status: "ready",
      });
    await db
      .insert(batches)
      .values({
        id: batchId,
        projectId,
        prompt: "circle",
        count: 1,
        judgeIterations: mode === "unreviewed" ? 0 : 1,
        design: "Green circles",
        designVersion: 1,
        status: "building",
      });
    await db
      .insert(assetVersions)
      .values({
        id: modelId,
        projectId,
        batchId,
        name: "Circle",
        prompt: "A green circle",
      });
    await db
      .insert(runs)
      .values({
        id: runId,
        projectId,
        batchId,
        modelId,
        role: "svg",
        engine: "tanstack",
        status: "done",
        model: "fixture",
        promptVersion: "test",
        systemPrompt: "test",
        input: "test",
        rates: { input: 0, output: 0, cached: 0, source: "test" },
        result: { svg },
      });
    const checkpoint: Record<string, string> = { "step:svg": runId };
    for (const role of mode === "unreviewed" ? [] : mode === "legacy-review" ? ["svg-judge"] : ["svg-reader", "svg-judge"]) {
      const id = crypto.randomUUID();
      const stepId = role === "svg-reader" ? "judge:0:reading" : "judge:0";
      await db.insert(runs).values({
        id, projectId, batchId, modelId, role, stepId, iteration: 0,
        engine: "tanstack", status: "done", model: "fixture",
        promptVersion: "test", systemPrompt: "test", input: "test",
        rates: { input: 0, output: 0, cached: 0, source: "test" },
        result: role === "svg-reader"
          ? { subject: "circle", alternatives: [], visibleFeatures: "round", smallSizeReading: "circle" }
          : { passed: true, score: 90, summary: "circle", improvements: [] },
      });
      checkpoint[`step:${stepId}`] = id;
    }
    await db
      .insert(jobs)
      .values({
        id: jobId,
        kind: "model",
        targetId: modelId,
        status: "running",
        checkpoint,
      });
    try {
      for (let i = 0; i < 2; i++)
        await jobContext.run({ id: jobId, checkpoint }, () =>
          executeAssetVersionJob(modelId),
        );
      const [model] = await db
        .select()
        .from(assetVersions)
        .where(eq(assetVersions.id, modelId));
      expect(model.status).toBe("done");
      expect(model.artifacts).toEqual({
        image: key,
        stage: "final",
        format: "svg",
      });
      expect(
        (await db.select().from(batches).where(eq(batches.id, batchId)))[0]
          .status,
      ).toBe("done");
      const savedRuns = await db.select().from(runs).where(eq(runs.modelId, modelId));
      expect(savedRuns).toHaveLength(mode === "unreviewed" ? 1 : mode === "legacy-review" ? 2 : 3);
      expect(savedRuns.find((run) => run.role === "svg")?.result).toMatchObject({
        previews: [
          { key: key.replace("graphic.svg", "preview.png") },
          { key: key.replace("graphic.svg", "preview-64.png") },
          { key: key.replace("graphic.svg", "preview-24.png") },
          { key: key.replace("graphic.svg", "preview-16.png") },
          { key: key.replace("graphic.svg", "preview-dark-64.png") },
          { key: key.replace("graphic.svg", "preview-dark-24.png") },
          { key: key.replace("graphic.svg", "preview-dark-16.png") },
        ],
      });
      expect(
        await db
          .select()
          .from(jobs)
          .where(inArray(jobs.targetId, [projectId, batchId, modelId])),
      ).toHaveLength(1);
      const response = await api(
        new Request(`http://localhost/api/files/${key}`),
      );
      expect(response.headers.get("content-type")).toBe("image/svg+xml");
      expect(response.headers.get("content-security-policy")).toContain(
        "sandbox",
      );
      expect(await response.text()).toBe(svg);
    } finally {
      for (const name of ["graphic.svg", "preview.png", "preview-64.png", "preview-24.png", "preview-16.png", "preview-dark-64.png", "preview-dark-24.png", "preview-dark-16.png"]) {
        const path = key.replace("graphic.svg", name);
        if (await getStorage().exists(path)) await getStorage().delete(path);
      }
      await db.delete(jobs).where(eq(jobs.id, jobId));
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
      await db.delete(batches).where(eq(batches.projectId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
);
