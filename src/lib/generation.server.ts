import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, models, projects } from "../db/schema";
import type { GenerationInput } from "./api-inputs";
import { assertNotArchived } from "./project-lifecycle.server";
import { snapshotWorkshop } from "./workshop.server";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function validateGeneration(project: typeof projects.$inferSelect, input: GenerationInput) {
  if (project.assetType !== "model" && input.spriteTarget)
    throw new Error("Sprite targets require a 3D collection");
  if (project.assetType === "model" && input.imageSize !== "1024x1024")
    throw new Error("Image size applies only to graphic projects");
}

export async function insertGeneration(tx: Transaction, project: typeof projects.$inferSelect, input: GenerationInput) {
  if (project.status !== "ready")
    throw new Error("Approve the design before generating assets");
  assertNotArchived(project);
  validateGeneration(project, input);
  const id = crypto.randomUUID();
  const workshop = snapshotWorkshop(project, project.workshop);
  await tx.insert(batches).values({
    id, projectId: project.id, ...input,
    visualTargetMode: input.visualTargetMode ?? "review",
    design: project.design, designVersion: project.designVersion, workshop,
  });
  await tx.insert(jobs).values({ id: crypto.randomUUID(), kind: "plan", targetId: id });
  return id;
}

export async function queueGeneration(projectId: string, input: GenerationInput) {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("Project not found");
    return insertGeneration(tx, project, input);
  });
}

/** Builds the same asset again against the project's current design. The saved name and prompt are kept,
 * so the planner is skipped and cannot invent a different idea. */
export async function regenerateAsset(modelId: string) {
  return db.transaction(async (tx) => {
    const [model] = await tx.select().from(models).where(eq(models.id, modelId));
    if (!model) throw new Error("Asset not found");
    const [project] = await tx.select().from(projects).where(eq(projects.id, model.projectId)).for("update");
    if (!project || project.status !== "ready")
      throw new Error("Approve the design before generating assets");
    assertNotArchived(project);
    const [previous] = await tx.select().from(batches).where(eq(batches.id, model.batchId));
    const batchId = crypto.randomUUID();
    const id = crypto.randomUUID();
    await tx.insert(batches).values({
      id: batchId, projectId: project.id, prompt: model.prompt, count: 1,
      judgeIterations: previous?.judgeIterations ?? 2,
      imageSize: previous?.imageSize ?? "1024x1024",
      spriteTarget: previous?.spriteTarget,
      visualTargetMode: previous?.visualTargetMode ?? "review",
      design: project.design, designVersion: project.designVersion,
      workshop: snapshotWorkshop(project, project.workshop),
      status: "building",
    });
    await tx.insert(models).values({ id, projectId: project.id, batchId, name: model.name, prompt: model.prompt });
    await tx.insert(jobs).values({ id: crypto.randomUUID(), kind: "model", targetId: id });
    return id;
  });
}
