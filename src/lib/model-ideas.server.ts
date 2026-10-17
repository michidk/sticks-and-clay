import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { batches, modelIdeas, models, projects } from "../db/schema";
import { generationInput, type IdeaInput } from "./api-inputs";
import { roleInput, runRole } from "../modules/ai/index.server";
import { insertGeneration, validateGeneration } from "./generation.server";
import { assertNotArchived, deleteAssetIn } from "./project-lifecycle.server";

export async function listModelIdeas(projectId: string) {
  return db.select().from(modelIdeas).where(and(
    eq(modelIdeas.projectId, projectId), isNull(modelIdeas.batchId),
  )).orderBy(desc(modelIdeas.createdAt));
}

type TitleWriter = (projectId: string, brief: string) => Promise<string>;
const writeTitle: TitleWriter = async (projectId, brief) =>
  (await runRole({ projectId, role: "idea-title", input: await roleInput("idea-title", { brief }) })).result.title;

/** The owner's title wins; a blank one is written by a small paid AI call from the brief.
 * A provider failure rejects the save, so no idea is stored untitled. */
const resolveTitle = (titleFor: TitleWriter, projectId: string, title: string, brief: string) =>
  title ? title : titleFor(projectId, brief);

export async function saveModelIdea(
  project: typeof projects.$inferSelect, { title: requested, ...input }: IdeaInput, titleFor: TitleWriter = writeTitle,
) {
  validateGeneration(project, input);
  const id = crypto.randomUUID();
  const title = await resolveTitle(titleFor, project.id, requested, input.prompt);
  await db.insert(modelIdeas).values({ id, projectId: project.id, title, input });
  return { id, title };
}

export async function updateModelIdea(
  project: typeof projects.$inferSelect, ideaId: string, { title: requested, ...input }: IdeaInput, titleFor: TitleWriter = writeTitle,
) {
  validateGeneration(project, input);
  const unstarted = and(eq(modelIdeas.id, ideaId), eq(modelIdeas.projectId, project.id), isNull(modelIdeas.batchId));
  // Check first so a started or foreign idea never costs an AI call.
  if (!(await db.select({ id: modelIdeas.id }).from(modelIdeas).where(unstarted)).length)
    throw new Error("Idea is no longer available for editing");
  const title = await resolveTitle(titleFor, project.id, requested, input.prompt);
  const updated = await db.update(modelIdeas).set({ title, input }).where(unstarted).returning({ id: modelIdeas.id });
  if (!updated.length) throw new Error("Idea is no longer available for editing");
  return { id: ideaId, title };
}

export async function discardModelIdea(projectId: string, ideaId: string) {
  const removed = await db.delete(modelIdeas).where(and(
    eq(modelIdeas.id, ideaId), eq(modelIdeas.projectId, projectId), isNull(modelIdeas.batchId),
  )).returning({ id: modelIdeas.id });
  if (!removed.length) throw new Error("Idea is no longer available");
}

export async function startModelIdea(projectId: string, ideaId: string) {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("Project not found");
    const [idea] = await tx.select().from(modelIdeas).where(and(
      eq(modelIdeas.id, ideaId), eq(modelIdeas.projectId, projectId),
    )).for("update");
    if (!idea) throw new Error("Idea is no longer available");
    if (idea.batchId) return idea.batchId;
    const batchId = await insertGeneration(tx, project, generationInput.parse(idea.input));
    await tx.update(modelIdeas).set({ batchId }).where(eq(modelIdeas.id, idea.id));
    return batchId;
  });
}

export async function setModelIdeaReady(projectId: string, ideaId: string, ready: boolean) {
  const updated = await db.update(modelIdeas).set({ readyAt: ready ? new Date() : null }).where(and(
    eq(modelIdeas.id, ideaId), eq(modelIdeas.projectId, projectId), isNull(modelIdeas.batchId),
  )).returning({ id: modelIdeas.id });
  if (!updated.length) throw new Error("Idea is no longer available");
}

/**
 * Turns a generated asset back into an unstarted idea, optionally deleting the asset in the same step.
 * The idea is the one the asset's collection entry was started from (its root attempt, so iterations
 * share it), copied with its title, brief, settings and Ready marker. Assets that never came from an
 * idea (direct generation, forks, imports) get one built from the asset itself: its name, its own
 * prompt, one deliverable and its batch's settings. No AI request is made.
 */
export async function returnModelToIdea(modelId: string, deleteModel: boolean) {
  return db.transaction(async (tx) => {
    const [model] = await tx.select().from(models).where(eq(models.id, modelId));
    if (!model) throw new Error("Asset not found");
    const [project] = await tx.select().from(projects).where(eq(projects.id, model.projectId));
    assertNotArchived(project);
    const all = await tx.select().from(models).where(eq(models.projectId, model.projectId));
    const byId = new Map(all.map((item) => [item.id, item]));
    let root = model;
    for (const seen = new Set([root.id]); root.branchKind === "iterate" && root.parentModelId;) {
      const parent = byId.get(root.parentModelId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      root = parent;
    }
    const [original] = await tx.select().from(modelIdeas).where(and(
      eq(modelIdeas.projectId, model.projectId), eq(modelIdeas.batchId, root.batchId),
    ));
    const [batch] = await tx.select().from(batches).where(eq(batches.id, root.batchId));
    const name = root.name.replaceAll("_", " ");
    // Ideas need a title and a brief; ones saved before that was required fall back to the asset's own.
    const title = original?.title?.trim() || name;
    const input = original
      ? { ...original.input, prompt: original.input.prompt?.trim() || root.prompt }
      : {
        prompt: root.prompt, count: 1, judgeIterations: batch?.judgeIterations ?? 2,
        imageSize: batch?.imageSize ?? "1024x1024", visualTargetMode: batch?.visualTargetMode === "skip" ? "skip" as const : "review" as const,
        spriteTarget: batch?.spriteTarget ?? undefined,
      };
    const id = crypto.randomUUID();
    await tx.insert(modelIdeas).values({ id, projectId: model.projectId, title, input, readyAt: original?.readyAt ?? null });
    if (deleteModel) await deleteAssetIn(tx, model.id);
    return { id, title, deleted: deleteModel };
  });
}
