import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { assetEntries, mockups, projects } from "../db/schema";
import { assertNotArchived } from "./project-lifecycle.server";
import { prepareReferences, retainedNotes } from "./reference-images.server";

const savedState = z.object({ references: z.array(z.string()), referenceNotes: z.record(z.string(), z.string()) });

export async function updateAssetReferences(projectId: string, assetId: string, form: FormData) {
  const [asset] = await db.select().from(assetEntries).where(and(eq(assetEntries.id, assetId), eq(assetEntries.projectId, projectId)));
  if (!asset) throw new Error("Asset not found");
  const expected = savedState.parse(JSON.parse(String(form.get("expected"))));
  const prepared = await prepareReferences(form, asset.references);
  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
      if (!project) throw new Error("Project not found");
      assertNotArchived(project);
      const [current] = await tx.select().from(assetEntries).where(and(eq(assetEntries.id, assetId), eq(assetEntries.projectId, projectId))).for("update");
      if (!current) throw new Error("Asset not found");
      if (JSON.stringify(current.references) !== JSON.stringify(expected.references) || JSON.stringify(current.referenceNotes) !== JSON.stringify(expected.referenceNotes))
        throw new Error("Asset references changed. Reload before saving.");
      const referenceNotes = retainedNotes(JSON.parse(String(form.get("referenceNotes") ?? "{}")), prepared.references);
      await tx.update(assetEntries).set({ references: prepared.references, referenceNotes }).where(eq(assetEntries.id, assetId));
      return { references: prepared.references, referenceNotes };
    });
  } catch (error) {
    await prepared.rollback();
    throw error;
  }
}

export async function attachMockupToAsset(projectId: string, assetId: string, mockupId: string, note: string) {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("Project not found");
    assertNotArchived(project);
    const [asset] = await tx.select().from(assetEntries).where(and(eq(assetEntries.id, assetId), eq(assetEntries.projectId, projectId))).for("update");
    const [mockup] = await tx.select().from(mockups).where(and(eq(mockups.id, mockupId), eq(mockups.projectId, projectId)));
    if (!asset || !mockup) throw new Error("Asset or mockup not found");
    const references = [...new Set([...asset.references, mockup.key])];
    if (references.length > 6) throw new Error("Remove an asset reference before adding another.");
    const referenceNotes = retainedNotes({ ...asset.referenceNotes, [mockup.key]: note }, references);
    await tx.update(assetEntries).set({ references, referenceNotes }).where(eq(assetEntries.id, assetId));
    return { references, referenceNotes };
  });
}
