import { test, expect } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, models, runs, jobs } from "../db/schema";
import { jobContext } from "./checkpoint.server";
import { executeModelJob } from "./model-pipeline.server";
import { getStorage } from "./storage.server";
import { api } from "./api.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration(
  "SVG resumes a saved response, publishes vectors and completes without Blender or duplicate runs",
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
        judgeIterations: 0,
        design: "Green circles",
        designVersion: 1,
        status: "building",
      });
    await db
      .insert(models)
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
    const checkpoint = { "step:svg": runId };
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
          executeModelJob(modelId),
        );
      const [model] = await db
        .select()
        .from(models)
        .where(eq(models.id, modelId));
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
      expect(
        await db.select().from(runs).where(eq(runs.modelId, modelId)),
      ).toHaveLength(1);
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
      if (await getStorage().exists(key)) await getStorage().delete(key);
      await db.delete(jobs).where(eq(jobs.id, jobId));
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(models).where(eq(models.projectId, projectId));
      await db.delete(batches).where(eq(batches.projectId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
);
