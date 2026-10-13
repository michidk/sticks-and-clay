import { referencedChange } from "./object-reference";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, models, runs, jobs } from "../db/schema";
import { api } from "./api.server";
import { roleInput } from "../modules/ai/index.server";
import { jobContext } from "./checkpoint.server";
import { executeJob } from "./pipeline.server";
import { revisions } from "../db/schema";

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
          glb: "models/source.glb",
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
      const objectReference = { glb: "models/source.glb", nodeId: "0/0/1", name: "arch", path: ["Scene", "marker", "arch"] };
      const branchRequest = (glb: string) => api(new Request(`http://localhost/api/models/${modelId}/branch`, {
        method: "POST", body: JSON.stringify({ kind: "iterate", sourceRunId: runId, prompt: "Widen this part", judgeIterations: 0, objectReference: { ...objectReference, glb } }),
      }));
      const stale = await branchRequest("versions/other/asset.glb");
      expect(stale.status).toBe(400);
      expect((await stale.json()).error).toContain("different model version");
      const referenced = await branchRequest(objectReference.glb);
      expect(referenced.status).toBe(201);
      const referencedId = (await referenced.json()).id;
      const [referencedModel] = await db.select().from(models).where(eq(models.id, referencedId));
      expect(referencedModel.objectReference).toEqual(objectReference);
      expect(referencedModel.changePrompt).toBe("Widen this part");
      expect(referencedModel.prompt).toContain("Widen this part");
      expect(referencedModel.prompt).not.toContain("Selected object from saved version");
      expect(referencedModel.prompt).not.toContain('"nodeId"');
      const builderInput = await roleInput("builder", {
        version: 2, design: "# Snapshotted design", name: "Marker", request: referencedChange(referencedModel.prompt, runId, referencedModel.objectReference!),
        capability: "poly", directory: "/tmp/fixture", previous: "models/source.blend", feedback: "null", stage: "geometry", target: "None",
      });
      expect(builderInput).toContain(`Selected object from saved version ${runId}`);
      expect(builderInput).toContain('"path": [');
      const reloaded = await (await api(new Request(`http://localhost/api/projects/${projectId}`))).json();
      expect(reloaded.models.find((item: { id: string }) => item.id === referencedId).objectReference).toEqual(objectReference);
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
      const [firstUpdate, secondUpdate] = await Promise.all([0, 1].map(() => api(
        new Request(`http://localhost/api/models/${modelId}/design-update`, {
          method: "POST",
          body: JSON.stringify({ sourceRunId: runId, view: 0 }),
        }),
      )));
      expect([firstUpdate.status, secondUpdate.status].sort()).toEqual([201, 400]);
      const designResponse = firstUpdate.status === 201 ? firstUpdate : secondUpdate;
      expect(designResponse.status).toBe(201);
      const designJob = (
        await db.select().from(jobs).where(eq(jobs.targetId, projectId))
      )[0];
      expect(designJob.kind).toBe("design-from-model");
      expect(designJob.checkpoint.view).toBe("models/front.png");
      expect(designJob.checkpoint.designVersion).toBe("3");
      const duplicate = await api(new Request(`http://localhost/api/models/${modelId}/design-update`, {
        method: "POST",
        body: JSON.stringify({ sourceRunId: runId, view: 0 }),
      }));
      expect(duplicate.status).toBe(400);
      expect((await duplicate.json()).error).toContain("in progress");
      const saveWhileUpdating = await api(new Request(`http://localhost/api/projects/${projectId}/design`, {
        method: "PUT",
        body: JSON.stringify({ design: "# New design\n" + "Warm stone. ".repeat(12), version: 3, approve: true }),
      }));
      expect(saveWhileUpdating.status).toBe(400);
      expect((await saveWhileUpdating.json()).error).toContain("in progress");
      const queue = await (await api(new Request("http://localhost/api/queue"))).json();
      expect(queue.jobs.find((job: { id: string }) => job.id === designJob.id)).toMatchObject({
        kind: "design-from-model", projectId, modelId, name: "Design update from model · Marker",
      });
      const workspace = await (await api(new Request(`http://localhost/api/projects/${projectId}`))).json();
      expect(workspace.activeJobs.find((job: { id: string }) => job.id === designJob.id)).toMatchObject({ modelId, status: "queued" });
      const projectList = await (await api(new Request("http://localhost/api/projects"))).json();
      expect(projectList.projects.find((project: { id: string }) => project.id === projectId).designUpdating).toBe(true);
      await db.update(jobs).set({ status: "cancelled" }).where(eq(jobs.id, designJob.id));
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
      const draftRunId = crypto.randomUUID();
      const design = "# Updated design\n" + "Warm stone and broad arches. ".repeat(12);
      await db.insert(runs).values({
        id: draftRunId, projectId, modelId, role: "design-from-model", engine: "tanstack", status: "done",
        model: "fixture", promptVersion: "fixture", systemPrompt: "fixture", input: "fixture",
        rates: { input: 0, cached: 0, output: 0, source: "fixture" }, result: { design },
      });
      const context = { id: replacementId, checkpoint: { ...replacementJob.checkpoint, "direct:design-from-model": draftRunId } };
      await db.update(jobs).set({ status: "running", checkpoint: context.checkpoint }).where(eq(jobs.id, replacementId));
      await jobContext.run(context, () => executeJob("design-from-model", projectId));
      await db.update(jobs).set({ status: "done" }).where(eq(jobs.id, replacementId));
      const [updatedProject] = await db.select().from(projects).where(eq(projects.id, projectId));
      expect(updatedProject).toMatchObject({ status: "review", designVersion: 4, design });
      const saveDesign = (version: number) => api(new Request(`http://localhost/api/projects/${projectId}/design`, {
        method: "PUT", body: JSON.stringify({ design, version, approve: true }),
      }));
      expect((await saveDesign(3)).status).toBe(400);
      expect((await saveDesign(4)).status).toBe(200);
      expect((await db.select().from(projects).where(eq(projects.id, projectId)))[0].status).toBe("ready");
      expect((await db.select().from(batches).where(eq(batches.id, batchId)))[0].design).toBe("# Snapshotted design");
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
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(models).where(eq(models.id, modelId));
      await db.delete(batches).where(eq(batches.id, batchId));
      await db.delete(revisions).where(eq(revisions.projectId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
);
