import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, assetVersions, projects, runs } from "../db/schema";
import { api } from "./api.server";

// Use an isolated migrated database with no worker.
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

integration("deleting an asset removes its iterations, keeps forks and request records, and refuses running work", async () => {
  const id = crypto.randomUUID(), batchId = crypto.randomUUID();
  const [root, iteration, fork, busy] = [1, 2, 3, 4].map(() => crypto.randomUUID());
  const remove = (modelId: string) => api(new Request(`http://localhost/api/models/${modelId}`, { method: "DELETE" }));
  const remaining = async () => (await db.select({ id: assetVersions.id }).from(assetVersions).where(eq(assetVersions.projectId, id))).map((m) => m.id).sort();
  try {
    await db.insert(projects).values({ id, name: "Delete assets", description: "t", design: "d", designVersion: 1, status: "ready", assetType: "graphic" });
    await db.insert(batches).values({ id: batchId, projectId: id, prompt: "x", count: 1, judgeIterations: 0, design: "d", designVersion: 1, status: "done" });
    await db.insert(assetVersions).values([
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
    await db.delete(assetVersions).where(eq(assetVersions.projectId, id));
    await db.delete(batches).where(eq(batches.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});

integration("a waiting visual target can be cancelled and deleted without losing request costs", async () => {
  const projectId = crypto.randomUUID(), batchId = crypto.randomUUID(), modelId = crypto.randomUUID(), jobId = crypto.randomUUID();
  try {
    await db.insert(projects).values({ id: projectId, name: "Delete waiting target", description: "test", status: "ready" });
    await db.insert(batches).values({ id: batchId, projectId, prompt: "snow slab", count: 1, judgeIterations: 0, design: "snow", designVersion: 1, status: "building" });
    await db.insert(assetVersions).values({ id: modelId, projectId, batchId, name: "slab", prompt: "snow slab", status: "awaiting_approval", visualTarget: "models/slab.png" });
    await db.insert(jobs).values({ id: jobId, kind: "model", targetId: modelId, status: "waiting", checkpoint: { "visual-target": "models/slab.png" } });
    await db.insert(runs).values({ id: crypto.randomUUID(), projectId, modelId, role: "visual-target", model: "test", promptVersion: "1", systemPrompt: "", input: "", status: "done", estimatedCost: 0.02, rates: { input: 0, cached: 0, output: 0, source: "test" } });

    const abort = await api(new Request(`http://localhost/api/asset-versions/${modelId}/abort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
    expect(abort.status).toBe(200);
    expect(await abort.json()).toEqual({ status: "cancelled" });
    expect((await api(new Request(`http://localhost/api/models/${modelId}`, { method: "DELETE" }))).status).toBe(200);
    expect(await db.select().from(assetVersions).where(eq(assetVersions.id, modelId))).toHaveLength(0);
    expect((await db.select().from(jobs).where(eq(jobs.id, jobId)))[0].status).toBe("cancelled");
    expect((await db.select().from(batches).where(eq(batches.id, batchId)))[0].status).toBe("completed_with_errors");
    expect((await db.select().from(runs).where(eq(runs.projectId, projectId)))[0].estimatedCost).toBe(0.02);
  } finally {
    await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
    await db.delete(batches).where(eq(batches.id, batchId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
});
