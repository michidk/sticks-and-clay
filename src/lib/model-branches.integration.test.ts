import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, models, runs, jobs } from "../db/schema";
import { api } from "./api.server";
import { roleInput } from "../modules/ai/index.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

test("model design updates keep the existing design in the image-guided prompt", async () => {
  const input = await roleInput("design-from-model", {
    name: "Fixture",
    version: 2,
    design: "Existing design rule",
    model: "Marker",
    request: "Make a stone marker",
    summary: "A broad arch was exported",
    metrics: "{}",
    feedback: "null",
  });
  expect(input).toContain("CURRENT DESIGN");
  expect(input).toContain("Existing design rule");
  expect(input).toContain("selected render");
  expect(input).toContain("A broad arch was exported");
});

integration(
  "a saved model version can be forked with a fresh round limit and source snapshot",
  async () => {
    const projectId = crypto.randomUUID(),
      batchId = crypto.randomUUID();
    const modelId = crypto.randomUUID(),
      runId = crypto.randomUUID();
    await db.insert(projects).values({
      id: projectId,
      name: "Branch fixture",
      description: "",
      design: "# Design\n" + "Warm stone. ".repeat(12),
      designVersion: 3,
      status: "ready",
      references: ["references/original.png"],
    });
    await db.insert(batches).values({
      id: batchId,
      projectId,
      prompt: "Original",
      count: 1,
      judgeIterations: 1,
      design: "# Snapshotted design",
      designVersion: 2,
      status: "done",
    });
    await db.insert(models).values({
      id: modelId,
      projectId,
      batchId,
      name: "Marker",
      prompt: "A detailed stone marker",
      status: "done",
    });
    await db.insert(runs).values({
      id: runId,
      projectId,
      batchId,
      modelId,
      role: "builder",
      status: "done",
      model: "fixture",
      promptVersion: "fixture",
      systemPrompt: "",
      input: "",
      rates: { input: 1, cached: 1, output: 1, source: "fixture" },
      result: {
        artifacts: {
          blend: "models/source.blend",
          renders: ["models/front.png"],
        },
      },
    });
    try {
      const response = await api(
        new Request(`http://localhost/api/models/${modelId}/branch`, {
          method: "POST",
          body: JSON.stringify({
            kind: "fork",
            sourceRunId: runId,
            prompt: "Make the arch wider",
            name: "Wide marker",
            judgeIterations: 4,
          }),
        }),
      );
      expect(response.status).toBe(201);
      const { id } = (await response.json()) as { id: string };
      const [branch] = await db.select().from(models).where(eq(models.id, id));
      const [batch] = await db
        .select()
        .from(batches)
        .where(eq(batches.id, branch.batchId));
      const queued = await db.select().from(jobs).where(eq(jobs.targetId, id));
      expect(branch.parentModelId).toBe(modelId);
      expect(branch.sourceRunId).toBe(runId);
      expect(branch.changePrompt).toBe("Make the arch wider");
      expect(branch.prompt).toContain("A detailed stone marker");
      expect(batch.design).toBe("# Snapshotted design");
      expect(batch.judgeIterations).toBe(4);
      expect(queued[0].checkpoint["branch-references"]).toBe(
        '["references/original.png"]',
      );
      const wrongSource = await api(
        new Request(`http://localhost/api/models/${id}/branch`, {
          method: "POST",
          body: JSON.stringify({
            kind: "iterate",
            sourceRunId: runId,
            prompt: "Change it",
            judgeIterations: 0,
          }),
        }),
      );
      expect(wrongSource.status).toBe(400);
      const designResponse = await api(
        new Request(`http://localhost/api/models/${modelId}/design-update`, {
          method: "POST",
          body: JSON.stringify({ sourceRunId: runId, view: 0 }),
        }),
      );
      expect(designResponse.status).toBe(201);
      const designJob = (
        await db.select().from(jobs).where(eq(jobs.targetId, projectId))
      )[0];
      expect(designJob.kind).toBe("design-from-model");
      expect(designJob.checkpoint.view).toBe("models/front.png");
      expect(designJob.checkpoint.designVersion).toBe("3");
      const missingView = await api(
        new Request(`http://localhost/api/models/${modelId}/design-update`, {
          method: "POST",
          body: JSON.stringify({ sourceRunId: runId, view: 2 }),
        }),
      );
      expect(missingView.status).toBe(400);
      const fullReferences = Array.from(
        { length: 6 },
        (_, index) => `references/${index}.png`,
      );
      await db
        .update(projects)
        .set({ references: fullReferences })
        .where(eq(projects.id, projectId));
      const noReplacement = await api(
        new Request(`http://localhost/api/models/${modelId}/design-update`, {
          method: "POST",
          body: JSON.stringify({ sourceRunId: runId, view: 0 }),
        }),
      );
      expect(noReplacement.status).toBe(400);
      const replacement = await api(
        new Request(`http://localhost/api/models/${modelId}/design-update`, {
          method: "POST",
          body: JSON.stringify({
            sourceRunId: runId,
            view: 0,
            replaceReference: fullReferences[2],
          }),
        }),
      );
      expect(replacement.status).toBe(201);
      const replacementId = ((await replacement.json()) as { id: string }).id;
      const [replacementJob] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, replacementId));
      expect(JSON.parse(replacementJob.checkpoint.references)).not.toContain(
        fullReferences[2],
      );
      expect(JSON.parse(replacementJob.checkpoint.references)).toHaveLength(5);
    } finally {
      await db.delete(jobs).where(eq(jobs.targetId, projectId));
      const child = await db
        .select()
        .from(models)
        .where(eq(models.parentModelId, modelId));
      for (const item of child) {
        await db.delete(jobs).where(eq(jobs.targetId, item.id));
        await db.delete(models).where(eq(models.id, item.id));
        await db.delete(batches).where(eq(batches.id, item.batchId));
      }
      await db.delete(runs).where(eq(runs.id, runId));
      await db.delete(models).where(eq(models.id, modelId));
      await db.delete(batches).where(eq(batches.id, batchId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
);
