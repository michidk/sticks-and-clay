import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, models, projects } from "../db/schema";
import { api } from "./api.server";

// Use an isolated migrated database with no worker.
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

integration("regenerating an asset rebuilds it on the current design without planning again", async () => {
  const id = crypto.randomUUID(), oldBatch = crypto.randomUUID(), modelId = crypto.randomUUID();
  const call = (path: string, body = {}) => api(new Request(`http://localhost/api/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  try {
    await db.insert(projects).values({ id, name: "Regenerate", description: "t", design: "Design two", designVersion: 2, status: "ready", assetType: "graphic" });
    await db.insert(batches).values({ id: oldBatch, projectId: id, prompt: "brief", count: 3, judgeIterations: 1, design: "Design one", designVersion: 1, imageSize: "1536x1024", status: "done" });
    await db.insert(models).values({ id: modelId, projectId: id, batchId: oldBatch, name: "Fist signal", prompt: "Exact saved prompt", status: "done" });

    const response = await call(`models/${modelId}/regenerate`);
    expect(response.status).toBe(201);
    const created = (await response.json()).id as string;
    const [copy] = await db.select().from(models).where(eq(models.id, created));
    expect([copy.name, copy.prompt]).toEqual(["Fist signal", "Exact saved prompt"]);
    const [batch] = await db.select().from(batches).where(eq(batches.id, copy.batchId));
    expect([batch.designVersion, batch.design, batch.count, batch.judgeIterations, batch.imageSize, batch.status])
      .toEqual([2, "Design two", 1, 1, "1536x1024", "building"]);
    const queued = await db.select().from(jobs).where(inArray(jobs.targetId, [created, batch.id]));
    expect(queued.map((job) => job.kind)).toEqual(["model"]);

    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, id));
    expect((await call(`models/${modelId}/regenerate`)).status).toBe(400);
  } finally {
    const all = await db.select({ id: batches.id }).from(batches).where(eq(batches.projectId, id));
    const ms = await db.select({ id: models.id }).from(models).where(eq(models.projectId, id));
    await db.delete(jobs).where(inArray(jobs.targetId, [...all.map((b) => b.id), ...ms.map((m) => m.id)]));
    await db.delete(models).where(eq(models.projectId, id));
    await db.delete(batches).where(eq(batches.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});
