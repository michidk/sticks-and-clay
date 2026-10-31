import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { assetEntries, assetHistory, assetVersions, batches, projects, runs } from "../db/schema";
import { api } from "./api.server";
import { generationInput } from "./api-inputs";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const patch = (path: string, body: unknown) => api(new Request(`http://localhost/api/${path}`, {
  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));

integration("rename changes only project and asset labels, records title history, and supports archived projects", async () => {
  const projectId = crypto.randomUUID(), otherId = crypto.randomUUID();
  const assetId = crypto.randomUUID(), batchId = crypto.randomUUID(), versionId = crypto.randomUUID();
  const input = generationInput.parse({ prompt: "Original brief", count: 1, judgeIterations: 0 });
  try {
    await db.insert(projects).values([
      { id: projectId, name: "Original project", description: "Original description", design: "Approved design", designVersion: 1, status: "ready" },
      { id: otherId, name: "Other project", description: "Other" },
    ]);
    await db.insert(batches).values({ id: batchId, projectId, prompt: input.prompt, count: 1, judgeIterations: 0, design: "Approved design", designVersion: 1, status: "done" });
    await db.insert(assetEntries).values({ id: assetId, projectId, title: "Original asset", input, inIdea: false, batchId });
    await db.insert(assetVersions).values({ id: versionId, assetId, projectId, batchId, name: "original_version", prompt: input.prompt, status: "done" });
    const endpoint = `projects/${projectId}/assets/${assetId}`;
    expect((await patch(`projects/${projectId}`, { name: "  New project  " })).status).toBe(200);
    expect((await patch(endpoint, { name: "  New asset  " })).status).toBe(200);
    expect((await db.select().from(projects).where(eq(projects.id, projectId)))[0]).toMatchObject({
      name: "New project", description: "Original description", design: "Approved design", designVersion: 1, status: "ready",
    });
    expect((await db.select().from(assetEntries).where(eq(assetEntries.id, assetId)))[0]).toMatchObject({ title: "New asset", input, inIdea: false, batchId });
    expect((await db.select().from(assetVersions).where(eq(assetVersions.id, versionId)))[0]).toMatchObject({ name: "original_version", prompt: input.prompt, status: "done" });
    expect((await db.select().from(batches).where(eq(batches.id, batchId)))[0].design).toBe("Approved design");
    const edits = await db.select().from(assetHistory).where(eq(assetHistory.assetId, assetId));
    expect(edits.find((entry) => entry.kind === "edited")?.detail).toEqual({ title: { from: "Original asset", to: "New asset" } });
    for (const body of [{ name: "   " }, { name: "x".repeat(101) }, { name: 7 }, { name: "Valid", prompt: "Changed brief" }]) {
      expect((await patch(`projects/${projectId}`, body)).status).toBe(400);
      expect((await patch(endpoint, body)).status).toBe(400);
    }
    expect((await patch(`projects/${otherId}/assets/${assetId}`, { name: "Wrong owner" })).ok).toBe(false);
    expect((await patch(`projects/${projectId}/assets/${crypto.randomUUID()}`, { name: "Missing" })).ok).toBe(false);
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, projectId));
    expect((await patch(`projects/${projectId}`, { name: "Archived project" })).status).toBe(200);
    expect((await patch(endpoint, { name: "Archived asset" })).status).toBe(200);
    expect((await db.select().from(projects).where(eq(projects.id, projectId)))[0].archivedAt).not.toBeNull();
    expect(await db.select().from(runs).where(eq(runs.projectId, projectId))).toHaveLength(0);
  } finally {
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
    await db.delete(assetEntries).where(eq(assetEntries.projectId, projectId));
    await db.delete(batches).where(eq(batches.projectId, projectId));
    await db.delete(projects).where(inArray(projects.id, [projectId, otherId]));
  }
});
