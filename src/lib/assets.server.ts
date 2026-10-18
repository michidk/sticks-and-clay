import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { assetEntries, assetVersions, projects } from "../db/schema";
import { generationInput, type IdeaInput } from "./api-inputs";
import { roleInput, runRole } from "../modules/ai/index.server";
import { insertGeneration, validateGeneration } from "./generation.server";
import { assertNotArchived } from "./project-lifecycle.server";
import { validateStartingPoint } from "./starting-point.server";

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
  await validateStartingPoint(project.id, project.assetType, input.startingPoint);
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
  await validateStartingPoint(project.id, project.assetType, input.startingPoint);
  const ownedAsset = and(eq(assetEntries.id, ideaId), eq(assetEntries.projectId, project.id));
  // Check ownership before charging for a title.
  const [existing] = await db.select().from(assetEntries).where(ownedAsset);
  if (!existing)
    throw new Error("Asset is no longer available for editing");
  if (input.startingPoint && !existing.inIdea && input.startingPoint.sha256 !== existing.input.startingPoint?.sha256)
    throw new Error("Return the asset to Ideas before changing its starting point");
  input.startingPoint ??= existing.input.startingPoint;
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

/** Reopen an asset's brief, settings and references as a new idea. The original asset, its versions
 * and any running generation stay untouched, so this is allowed at any time. */
export async function reopenVersionAsIdea(versionId: string) {
  return db.transaction(async (tx) => {
    const [version] = await tx.select().from(assetVersions).where(eq(assetVersions.id, versionId));
    if (!version) throw new Error("Version not found");
    const [project] = await tx.select().from(projects).where(eq(projects.id, version.projectId)).for("update");
    assertNotArchived(project);
    const [asset] = await tx.select().from(assetEntries).where(eq(assetEntries.id, version.assetId));
    const id = crypto.randomUUID();
    await tx.insert(assetEntries).values({
      id, projectId: asset.projectId, title: asset.title, input: asset.input,
      references: asset.references, referenceNotes: asset.referenceNotes,
    });
    return { id, title: asset.title };
  });
}
