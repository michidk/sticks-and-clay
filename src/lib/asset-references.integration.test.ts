import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { assetEntries, mockups, projects } from "../db/schema";
import { attachMockupToAsset, updateAssetReferences } from "./asset-references.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

integration("asset references enforce project ownership, retain notes, reject stale edits and preserve mockup state", async () => {
  const projectId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const mockupId = crypto.randomUUID();
  const key = "references/asset-reference-fixture.png";
  try {
    await db.insert(projects).values([
      { id: projectId, name: "Asset refs", description: "Fixture" },
      { id: otherId, name: "Other", description: "Fixture" },
    ]);
    await db.insert(assetEntries).values({ id: assetId, projectId, title: "Switch", input: { prompt: "Switch", count: 1, judgeIterations: 0, imageSize: "1024x1024" } });
    await db.insert(mockups).values({ id: mockupId, projectId, key, source: "uploaded", designVersion: 0 });
    await expect(attachMockupToAsset(otherId, assetId, mockupId, "wrong project")).rejects.toThrow("Asset or mockup not found");
    const attached = await attachMockupToAsset(projectId, assetId, mockupId, "  Use the lever shape  ");
    expect(attached).toEqual({ references: [key], referenceNotes: { [key]: "Use the lever shape" } });
    expect((await db.select().from(mockups).where(eq(mockups.id, mockupId)))[0].acceptedAt).toBeNull();
    expect((await db.select().from(projects).where(eq(projects.id, projectId)))[0].references).toEqual([]);
    const form = new FormData();
    form.set("references", JSON.stringify([key]));
    form.set("referenceNotes", JSON.stringify({ [key]: "Keep the pivot", "references/foreign.png": "ignore" }));
    form.set("expected", JSON.stringify(attached));
    expect(await updateAssetReferences(projectId, assetId, form)).toEqual({ references: [key], referenceNotes: { [key]: "Keep the pivot" } });
    await expect(updateAssetReferences(projectId, assetId, form)).rejects.toThrow("Asset references changed");
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, projectId));
    await expect(attachMockupToAsset(projectId, assetId, mockupId, "archived")).rejects.toThrow("archived");
  } finally {
    await db.delete(assetEntries).where(eq(assetEntries.id, assetId));
    await db.delete(mockups).where(eq(mockups.id, mockupId));
    await db.delete(projects).where(inArray(projects.id, [projectId, otherId]));
  }
});
