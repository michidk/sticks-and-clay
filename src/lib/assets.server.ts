import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { assetEntries, assetVersions, projects } from "../db/schema";
import { generationInput, type IdeaInput } from "./api-inputs";
import { roleInput, runRole } from "../modules/ai/index.server";
import { insertGeneration, validateGeneration } from "./generation.server";
import { assertNotArchived } from "./project-lifecycle.server";

export async function listAssetDrafts(projectId: string) {
  return db.select().from(assetEntries).where(and(
    eq(assetEntries.projectId, projectId), eq(assetEntries.inIdea, true),
  )).orderBy(desc(assetEntries.createdAt));
}

type TitleWriter = (projectId: string, brief: string) => Promise<string>;
const writeTitle: TitleWriter = async (projectId, brief) =>
  (await runRole({ projectId, role: "idea-title", input: await roleInput("idea-title", { brief }) })).result.title;

/** The owner's title wins; a blank one is written by a small paid AI call from the brief.
 * A provider failure rejects the save, so no idea is stored untitled. */
const resolveTitle = (titleFor: TitleWriter, projectId: string, title: string, brief: string) =>
  title ? title : titleFor(projectId, brief);

export async function createAsset(
  project: typeof projects.$inferSelect, { title: requested, ...input }: IdeaInput, titleFor: TitleWriter = writeTitle,
) {
  assertNotArchived(project);
  validateGeneration(project, input);
  const id = crypto.randomUUID();
  const title = await resolveTitle(titleFor, project.id, requested, input.prompt);
  await db.insert(assetEntries).values({ id, projectId: project.id, title, input });
  return { id, title };
}

export async function updateAsset(
  project: typeof projects.$inferSelect, ideaId: string, { title: requested, ...input }: IdeaInput, titleFor: TitleWriter = writeTitle,
) {
  assertNotArchived(project);
  validateGeneration(project, input);
  const ownedAsset = and(eq(assetEntries.id, ideaId), eq(assetEntries.projectId, project.id));
  // Check ownership before charging for a title.
  if (!(await db.select({ id: assetEntries.id }).from(assetEntries).where(ownedAsset)).length)
    throw new Error("Asset is no longer available for editing");
  const title = await resolveTitle(titleFor, project.id, requested, input.prompt);
  const updated = await db.update(assetEntries).set({ title, input }).where(ownedAsset).returning({ id: assetEntries.id });
  if (!updated.length) throw new Error("Asset is no longer available for editing");
  return { id: ideaId, title };
}

export async function discardAssetDraft(projectId: string, ideaId: string) {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("Project not found");
    assertNotArchived(project);
    const [asset] = await tx.select().from(assetEntries).where(and(eq(assetEntries.id, ideaId), eq(assetEntries.projectId, projectId))).for("update");
    if (!asset?.inIdea) throw new Error("Asset is no longer in Ideas");
    const [version] = await tx.select({ id: assetVersions.id }).from(assetVersions).where(eq(assetVersions.assetId, ideaId)).limit(1);
    if (version) throw new Error("This asset has version history. Keep it or archive its project instead.");
    await tx.delete(assetEntries).where(eq(assetEntries.id, ideaId));
  });
}

export async function startAsset(projectId: string, ideaId: string) {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("Project not found");
    const [idea] = await tx.select().from(assetEntries).where(and(
      eq(assetEntries.id, ideaId), eq(assetEntries.projectId, projectId),
    )).for("update");
    if (!idea) throw new Error("Idea is no longer available");
    if (!idea.inIdea && idea.batchId) return idea.batchId;
    const batchId = await insertGeneration(tx, project, generationInput.parse({ ...idea.input, count: 1 }), idea);

    return batchId;
  });
}

export async function setAssetReady(projectId: string, ideaId: string, ready: boolean) {
  const updated = await db.update(assetEntries).set({ readyAt: ready ? new Date() : null }).where(and(
    eq(assetEntries.id, ideaId), eq(assetEntries.projectId, projectId), eq(assetEntries.inIdea, true),
  )).returning({ id: assetEntries.id });
  if (!updated.length) throw new Error("Idea is no longer available");
}

/** Return the same asset to Ideas while keeping every version and its accounting. */
export async function returnVersionToIdea(modelId: string, _deleteModel: boolean) {
  return db.transaction(async (tx) => {
    const [version] = await tx.select().from(assetVersions).where(eq(assetVersions.id, modelId));
    if (!version) throw new Error("Version not found");
    const [project] = await tx.select().from(projects).where(eq(projects.id, version.projectId)).for("update");
    assertNotArchived(project);
    const [asset] = await tx.select().from(assetEntries).where(eq(assetEntries.id, version.assetId)).for("update");
    const versions = await tx.select().from(assetVersions).where(eq(assetVersions.assetId, asset.id));
    if (versions.some((item) => !["done", "failed", "cancelled"].includes(item.status)))
      throw new Error("Wait for generation to finish before returning this asset to Ideas");
    await tx.update(assetEntries).set({ inIdea: true, readyAt: null }).where(eq(assetEntries.id, asset.id));
    return { id: asset.id, title: asset.title, deleted: false };
  });
}
