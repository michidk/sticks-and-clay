import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, models, projects, runs } from "../db/schema";
import { api } from "./api.server";

// Use an isolated migrated database with no worker.
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

integration("deleting an asset removes its iterations, keeps forks and request records, and refuses running work", async () => {
  const id = crypto.randomUUID(), batchId = crypto.randomUUID();
  const [root, iteration, fork, busy] = [1, 2, 3, 4].map(() => crypto.randomUUID());
  const remove = (modelId: string) => api(new Request(`http://localhost/api/models/${modelId}`, { method: "DELETE" }));
  const remaining = async () => (await db.select({ id: models.id }).from(models).where(eq(models.projectId, id))).map((m) => m.id).sort();
  try {
    await db.insert(projects).values({ id, name: "Delete assets", description: "t", design: "d", designVersion: 1, status: "ready", assetType: "graphic" });
    await db.insert(batches).values({ id: batchId, projectId: id, prompt: "x", count: 1, judgeIterations: 0, design: "d", designVersion: 1, status: "done" });
    await db.insert(models).values([
      { id: root, projectId: id, batchId, name: "root", prompt: "p", status: "done" },
      { id: iteration, projectId: id, batchId, name: "root", prompt: "p", status: "done", parentModelId: root, branchKind: "iterate" },
      { id: fork, projectId: id, batchId, name: "fork", prompt: "p", status: "done", parentModelId: root, branchKind: "fork" },
      { id: busy, projectId: id, batchId, name: "busy", prompt: "p", status: "building" },
    ]);
    await db.insert(runs).values({ id: crypto.randomUUID(), projectId: id, modelId: root, role: "graphic", model: "m", promptVersion: "1",
      systemPrompt: "", input: "", status: "done", rates: { input: 0, cached: 0, output: 0, source: "test" } });

    expect((await remove(busy)).status).toBe(400);
    expect((await remove(crypto.randomUUID())).status).toBe(400);
    expect((await remove(root)).status).toBe(200);
    expect(await remaining()).toEqual([fork, busy].sort());
    expect(await db.select().from(runs).where(eq(runs.projectId, id))).toHaveLength(1);

    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, id));
    expect((await remove(fork)).status).toBe(400);
  } finally {
    await db.delete(runs).where(eq(runs.projectId, id));
    await db.delete(jobs).where(inArray(jobs.targetId, [root, iteration, fork, busy]));
    await db.delete(models).where(eq(models.projectId, id));
    await db.delete(batches).where(eq(batches.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});
