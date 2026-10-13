import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { modelIdeas, projects } from "../db/schema";
import { generationInput, type GenerationInput } from "./api-inputs";
import { insertGeneration, validateGeneration } from "./generation.server";

export async function listModelIdeas(projectId: string) {
  return db.select().from(modelIdeas).where(and(
    eq(modelIdeas.projectId, projectId), isNull(modelIdeas.batchId),
  )).orderBy(desc(modelIdeas.createdAt));
}

export async function saveModelIdea(project: typeof projects.$inferSelect, input: GenerationInput) {
  validateGeneration(project, input);
  const id = crypto.randomUUID();
  await db.insert(modelIdeas).values({ id, projectId: project.id, input });
  return id;
}

export async function updateModelIdea(project: typeof projects.$inferSelect, ideaId: string, input: GenerationInput) {
  validateGeneration(project, input);
  const updated = await db.update(modelIdeas).set({ input }).where(and(
    eq(modelIdeas.id, ideaId), eq(modelIdeas.projectId, project.id), isNull(modelIdeas.batchId),
  )).returning({ id: modelIdeas.id });
  if (!updated.length) throw new Error("Idea is no longer available for editing");
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
