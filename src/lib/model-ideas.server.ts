import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { modelIdeas, projects } from "../db/schema";
import { generationInput, type IdeaInput } from "./api-inputs";
import { roleInput, runRole } from "../modules/ai/index.server";
import { insertGeneration, validateGeneration } from "./generation.server";

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
