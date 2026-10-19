import { expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { assetEntries, assetVersions, batches, jobs, projects } from "../db/schema";
import { api } from "./api.server";
import { createAsset, setAssetReady, startAsset, updateAsset } from "./assets.server";
import { cancelJob } from "./queue.server";

// Use an isolated migrated database with no worker.
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const design = "# Collection style\n" + "Simple ivory forms and forest green accents. ".repeat(4);
const input = { prompt: "A small sedan", count: 1, judgeIterations: 2, imageSize: "1024x1024" };

integration("triggers record an asset's edits and states, and an aborted first attempt returns it to Ideas", async () => {
  const id = crypto.randomUUID();
  const other = crypto.randomUUID();
  try {
    await db.insert(projects).values([
      { id, name: "History fixture", description: "test", design, designVersion: 1, status: "ready" },
      { id: other, name: "Other fixture", description: "test", design, designVersion: 1, status: "ready" },
    ]);
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    const { id: assetId } = await createAsset(project, { ...input, title: "Sedan" } as any);
    await updateAsset(project, assetId, { ...input, prompt: "A yellow cab", judgeIterations: 0, title: "Sedan" } as any);
    await updateAsset(project, assetId, { ...input, prompt: "A yellow cab", judgeIterations: 0, title: "Sedan" } as any);
    await setAssetReady(id, assetId, true);
    const batchId = await startAsset(id, assetId);
    const [plan] = await db.select().from(jobs).where(and(eq(jobs.kind, "plan"), eq(jobs.targetId, batchId)));
    expect(await cancelJob(plan.id)).toBe("cancelled");

    const [asset] = await db.select().from(assetEntries).where(eq(assetEntries.id, assetId));
    expect(asset).toMatchObject({ inIdea: true, batchId: null });
    expect(asset.readyAt).not.toBeNull();

    const response = await api(new Request(`http://localhost/api/projects/${id}/assets/${assetId}/history`));
    expect(response.status).toBe(200);
    const history = await response.json();
    // Newest first; the repeated identical save records nothing.
    expect(history.map((entry: { kind: string }) => entry.kind).reverse())
      .toEqual(["created", "edited", "ready", "started", "version", "status", "returned_to_ideas"]);
    const edited = history.find((entry: { kind: string }) => entry.kind === "edited");
    expect(edited.detail).toEqual({ prompt: { from: "A small sedan", to: "A yellow cab" }, settings: ["judgeIterations"] });
    expect(history.find((entry: { kind: string }) => entry.kind === "status").detail).toMatchObject({ from: "queued", to: "cancelled" });

    expect(await (await api(new Request(`http://localhost/api/projects/${other}/assets/${assetId}/history`))).json()).toEqual([]);
  } finally {
    const ids = [id, other];
    const savedBatches = await db.select({ id: batches.id }).from(batches).where(inArray(batches.projectId, ids));
    if (savedBatches.length) await db.delete(jobs).where(inArray(jobs.targetId, savedBatches.map((batch) => batch.id)));
    await db.delete(assetVersions).where(inArray(assetVersions.projectId, ids));
    await db.delete(assetEntries).where(inArray(assetEntries.projectId, ids));
    await db.delete(batches).where(inArray(batches.projectId, ids));
    await db.delete(projects).where(inArray(projects.id, ids));
  }
});
