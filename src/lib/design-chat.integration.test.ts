import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, jobs, runs, revisions } from "../db/schema";
import { api } from "./api.server";
import { jobContext } from "./checkpoint.server";
import { executeJob, failJob } from "./pipeline.server";
import { cancelJob } from "./queue.server";
import { roleInput } from "../modules/ai/index.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

test("design chat prompts preserve the document and requested changes for both asset types", async () => {
  for (const role of ["design-update", "graphic-design-update"] as const) {
    const input = await roleInput(role, {
      name: "Garden", description: "Stone ornaments", version: 3,
      design: "Keep silhouettes simple", prompt: "Use warmer stone",
    });
    expect(input).toContain("Keep silhouettes simple");
    expect(input).toContain("Use warmer stone");
    expect(input).toContain("Stone ornaments");
    expect(input).toContain("complete revised Markdown");
  }
});

for (const assetType of ["model", "graphic"] as const) {
  integration(`design chat queues, cancels and replays one safe ${assetType} revision`, async () => {
    const projectId = crypto.randomUUID();
    const batchId = crypto.randomUUID();
    const design = "# Design\n" + "Warm stone. ".repeat(12);
    const revised = "# Revised design\n" + "Warm ivory stone and rounded edges. ".repeat(12);
    const post = (prompt = "Round the edges", version = 3) => api(new Request(`http://localhost/api/projects/${projectId}/design-update`, {
      method: "POST", body: JSON.stringify({ prompt, version }),
    }));
    const getProject = async () => (await db.select().from(projects).where(eq(projects.id, projectId)))[0];
    await db.insert(projects).values({ id: projectId, name: "Chat fixture", assetType, description: "Garden ornaments", design, designVersion: 3, status: "ready" });
    await db.insert(batches).values({ id: batchId, projectId, prompt: "Original", count: 1, judgeIterations: 0, design, designVersion: 3, status: "done" });
    try {
      expect((await post(" ")).status).toBe(400);
      expect((await post("Round the edges", 2)).status).toBe(400);
      const responses = await Promise.all([post(), post()]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 400]);
      const [firstJob] = await db.select().from(jobs).where(eq(jobs.targetId, projectId));
      expect(firstJob.checkpoint).toMatchObject({ prompt: "Round the edges", design, designVersion: "3", assetType });
      expect(await getProject()).toMatchObject({ status: "ready", designVersion: 3, design });
      const saving = await api(new Request(`http://localhost/api/projects/${projectId}/design`, {
        method: "PUT", body: JSON.stringify({ design, version: 3, approve: true }),
      }));
      expect(saving.status).toBe(400);
      const queue = await (await api(new Request("http://localhost/api/queue"))).json();
      expect(queue.jobs.find((job: { id: string }) => job.id === firstJob.id)).toMatchObject({ kind: "design-update", projectId, status: "queued" });
      const workspace = await (await api(new Request(`http://localhost/api/projects/${projectId}`))).json();
      expect(workspace.designUpdates[0]).toMatchObject({ prompt: "Round the edges", designVersion: 3, resultVersion: null });
      expect(workspace.activeJobs[0].kind).toBe("design-update");
      const list = await (await api(new Request("http://localhost/api/projects"))).json();
      expect(list.projects.find((project: { id: string }) => project.id === projectId).designUpdating).toBe(true);
      await cancelJob(firstJob.id);
      expect(await getProject()).toMatchObject({ status: "ready", designVersion: 3, design });
      await failJob("design-update", projectId, "Provider failed");
      expect((await getProject()).status).toBe("ready");

      const queued = await post("Use ivory stone");
      expect(queued.status).toBe(201);
      const { id } = await queued.json();
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      const role = assetType === "graphic" ? "graphic-design-update" : "design-update";
      const runId = crypto.randomUUID();
      await db.insert(runs).values({
        id: runId, projectId, role, engine: "tanstack", status: "done",
        model: "fixture", promptVersion: "fixture", systemPrompt: "fixture", input: "fixture",
        rates: { input: 0, cached: 0, output: 0, source: "fixture" }, result: { design: revised },
      });
      const context = { id, checkpoint: { ...job.checkpoint, [`direct:${role}`]: runId } };
      await db.update(jobs).set({ status: "running", checkpoint: context.checkpoint }).where(eq(jobs.id, id));
      await jobContext.run(context, () => executeJob("design-update", projectId));
      await jobContext.run(context, () => executeJob("design-update", projectId));
      const [applied] = await db.select().from(jobs).where(eq(jobs.id, id));
      expect(applied.checkpoint).toMatchObject({ applied: "yes", resultVersion: "4", prompt: "Use ivory stone" });
      await jobContext.run({ id, checkpoint: applied.checkpoint }, () => executeJob("design-update", projectId));
      expect(await getProject()).toMatchObject({ status: "review", designVersion: 4, design: revised, references: [] });
      expect(await db.select().from(revisions).where(eq(revisions.projectId, projectId))).toHaveLength(1);
      expect((await db.select().from(batches).where(eq(batches.id, batchId)))[0]).toMatchObject({ design, designVersion: 3 });
      await db.update(jobs).set({ status: "done" }).where(eq(jobs.id, id));
      expect((await post("Use darker stone", 3)).status).toBe(400);
      const approve = await api(new Request(`http://localhost/api/projects/${projectId}/design`, {
        method: "PUT", body: JSON.stringify({ design: revised, version: 4, approve: true }),
      }));
      expect(approve.status).toBe(200);
      expect((await getProject()).status).toBe("ready");
    } finally {
      await db.delete(jobs).where(eq(jobs.targetId, projectId));
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(revisions).where(eq(revisions.projectId, projectId));
      await db.delete(batches).where(eq(batches.id, batchId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  });
}
