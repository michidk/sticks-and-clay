import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, assetEntries, assetVersions, jobs } from "../db/schema";
import { api } from "./api.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const call = (path: string, body: unknown, method = "POST") => api(new Request(`http://localhost/api/${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));

integration("project and asset APIs freeze resolution for queued generations", async () => {
  const id = crypto.randomUUID();
  await db.insert(projects).values({ id, name: "Resolution fixture", description: "test", assetType: "pixel", status: "ready" });
  try {
    expect((await call(`projects/${id}/workshop`, { resolution: { width: 256, height: 32 } }, "PUT")).status).toBe(400);
    expect((await call(`projects/${id}/workshop`, { resolution: { width: 32, height: 48 } }, "PUT")).status).toBe(200);
    const created = await call(`projects/${id}/assets`, { title: "Fixture", prompt: "A green tree", judgeIterations: 0 });
    expect(created.status).toBe(201);
    const { id: assetId } = await created.json();
    expect((await call(`projects/${id}/assets/${assetId}/generate`, {})).status).toBe(201);
    let saved = await db.select().from(batches).where(eq(batches.projectId, id));
    expect(saved[0].workshop?.resolution).toEqual({ width: 32, height: 48 });
    expect((await call(`projects/${id}/workshop`, { version: 1, resolution: { width: 64, height: 64 } }, "PUT")).status).toBe(200);
    await db.update(assetEntries).set({ inIdea: true }).where(eq(assetEntries.id, assetId));
    expect((await call(`projects/${id}/assets/${assetId}`, { title: "Fixture", prompt: "A green tree", judgeIterations: 0, resolution: { width: 16, height: 24 }, imageSize: "1536x1024" }, "PUT")).status).toBe(200);
    expect((await call(`projects/${id}/assets/${assetId}/generate`, {})).status).toBe(201);
    expect((await call(`projects/${id}/assets/${assetId}`, { title: "Renamed", prompt: "A green tree", judgeIterations: 0 }, "PUT")).status).toBe(200);
    const [updatedAsset] = await db.select().from(assetEntries).where(eq(assetEntries.id, assetId));
    expect(updatedAsset.input.resolution).toEqual({ width: 16, height: 24 });
    expect(updatedAsset.input.imageSize).toBe("1536x1024");
    expect((await call(`projects/${id}/workshop`, { version: 2, variation: 40 }, "PUT")).status).toBe(200);
    const [updatedProject] = await db.select().from(projects).where(eq(projects.id, id));
    expect(updatedProject.workshop?.resolution).toEqual({ width: 64, height: 64 });
    saved = await db.select().from(batches).where(eq(batches.projectId, id));
    expect(saved.map((batch) => batch.workshop?.resolution)).toContainEqual({ width: 16, height: 24 });
    expect(saved.map((batch) => batch.workshop?.resolution)).toContainEqual({ width: 32, height: 48 });
    await db.update(assetEntries).set({ inIdea: true }).where(eq(assetEntries.id, assetId));
    expect((await call(`projects/${id}/assets/${assetId}`, { title: "Fixture", prompt: "A green tree", judgeIterations: 0, resolution: null }, "PUT")).status).toBe(200);
    expect((await call(`projects/${id}/assets/${assetId}/generate`, {})).status).toBe(201);
    saved = await db.select().from(batches).where(eq(batches.projectId, id));
    expect(saved.map((batch) => batch.workshop?.resolution)).toContainEqual({ width: 64, height: 64 });
  } finally {
    const saved = await db.select().from(batches).where(eq(batches.projectId, id));
    if (saved.length) await db.delete(jobs).where(inArray(jobs.targetId, saved.map((batch) => batch.id)));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, id));
    await db.delete(assetEntries).where(eq(assetEntries.projectId, id));
    await db.delete(batches).where(eq(batches.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});

integration("an unsupported provider size completes with a review error and cannot spend again on recovery", async () => {
  const { runReviewedAsset } = await import("./reviewed-asset.server");
  const { jobContext } = await import("./checkpoint.server");
  const { UnsupportedResolution } = await import("./resolution");
  const id = crypto.randomUUID(), batchId = crypto.randomUUID(), modelId = crypto.randomUUID(), jobId = crypto.randomUUID();
  const [project] = await db.insert(projects).values({ id, name: "Unsupported resolution", description: "test", assetType: "graphic", status: "ready" }).returning();
  const [batch] = await db.insert(batches).values({ id: batchId, projectId: id, prompt: "tree", count: 1, judgeIterations: 0, design: "Green trees", designVersion: 1 }).returning();
  const [model] = await db.insert(assetVersions).values({ id: modelId, projectId: id, batchId, name: "Tree", prompt: "tree" }).returning();
  await db.insert(jobs).values({ id: jobId, kind: "model", targetId: modelId, status: "running" });
  let requests = 0;
  const checkpoint: Record<string, string> = {};
  try {
    for (let attempt = 0; attempt < 2; attempt++) await jobContext.run({ id: jobId, checkpoint }, () => runReviewedAsset({
      format: "png", judge: "graphic-judge", build: async () => { requests++; throw new UnsupportedResolution("Output dimension error: provider rejected 64x64"); },
    }, { project, batch, model, request: "tree", attempt: jobId, references: [] }));
    const [saved] = await db.select().from(assetVersions).where(eq(assetVersions.id, modelId));
    expect(saved.status).toBe("done");
    expect(saved.verdict).toBe("limit_reached");
    expect(saved.error).toBeNull();
    expect(saved.feedback).toMatchObject({ passed: false, summary: expect.stringContaining("rejected 64x64") });
    expect(requests).toBe(1);
    const [savedJob] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(savedJob.checkpoint?.applied).toBe("yes");
  } finally {
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, id));
    await db.delete(assetEntries).where(eq(assetEntries.projectId, id));
    await db.delete(batches).where(eq(batches.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});
