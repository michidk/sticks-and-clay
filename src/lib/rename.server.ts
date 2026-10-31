import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { assetEntries, projects } from "../db/schema";

export async function renameProject(projectId: string, name: string) {
  const [project] = await db.update(projects).set({ name }).where(eq(projects.id, projectId)).returning({ id: projects.id, name: projects.name });
  if (!project) throw new Error("Project not found");
  return project;
}

export async function renameAsset(projectId: string, assetId: string, name: string) {
  return db.transaction(async (tx) => {
    const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("Project not found");
    const [asset] = await tx.update(assetEntries).set({ title: name }).where(and(eq(assetEntries.id, assetId), eq(assetEntries.projectId, projectId))).returning({ id: assetEntries.id, title: assetEntries.title });
    if (!asset) throw new Error("Asset not found");
    return asset;
  });
}
