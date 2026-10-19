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
    expect((await call(`projects/${id}/assets/${assetId}`, { title: "Fixture", prompt: "A green tree", judgeIterations: 0, resolution: { width: 16, height: 24 } }, "PUT")).status).toBe(200);
    expect((await call(`projects/${id}/assets/${assetId}/generate`, {})).status).toBe(201);
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
