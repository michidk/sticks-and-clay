import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, projects } from "../db/schema";
import type { GenerationInput } from "./api-inputs";
import { snapshotWorkshop } from "./workshop.server";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function validateGeneration(project: typeof projects.$inferSelect, input: GenerationInput) {
  if (project.assetType === "graphic" && input.spriteTarget)
    throw new Error("Sprite targets require a 3D collection");
  if (project.assetType === "graphic" && input.judgeIterations !== 0)
    throw new Error("Graphic generation does not use 3D judge rounds");
  if (project.assetType === "model" && input.imageSize !== "1024x1024")
    throw new Error("Image size applies only to graphic projects");
}

export async function insertGeneration(tx: Transaction, project: typeof projects.$inferSelect, input: GenerationInput) {
  if (project.status !== "ready")
    throw new Error("Approve the design before generating assets");
  validateGeneration(project, input);
  const id = crypto.randomUUID();
  const workshop = await snapshotWorkshop(project.id, project.workshop);
  await tx.insert(batches).values({
    id, projectId: project.id, ...input,
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
