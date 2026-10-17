import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, models, projects, runs } from "../db/schema";
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

/** Iterates an asset on the project's current design: a new version inside the same collection entry,
 * built from its latest saved result and its own prompt, so the planner never reinterprets it. */
export async function regenerateAsset(modelId: string) {
  return db.transaction(async (tx) => {
    const [model] = await tx.select().from(models).where(eq(models.id, modelId));
    if (!model) throw new Error("Asset not found");
    const [project] = await tx.select().from(projects).where(eq(projects.id, model.projectId)).for("update");
    if (!project || project.status !== "ready")
      throw new Error("Approve the design before generating assets");
    assertNotArchived(project);
    const saved = await tx.select().from(runs).where(and(
      eq(runs.modelId, modelId), eq(runs.status, "done"), inArray(runs.role, ["builder", "graphic", "svg"]),
    )).orderBy(desc(runs.createdAt));
    const source = saved.find((run) => {
      const result = run.result as { key?: string; artifacts?: { blend?: string } } | null;
      return run.role === "builder" ? result?.artifacts?.blend : result?.key;
    });
    if (!source) throw new Error("This asset has no saved version to build on");
    const [previous] = await tx.select().from(batches).where(eq(batches.id, model.batchId));
    const batchId = crypto.randomUUID();
    const id = crypto.randomUUID();
    const change = `Update this asset for design version ${project.designVersion}. Keep its subject and purpose, and follow the current design and references.`;
    await tx.insert(batches).values({
      id: batchId, projectId: project.id, prompt: change, count: 1,
      judgeIterations: previous?.judgeIterations ?? 2,
      imageSize: previous?.imageSize ?? "1024x1024",
      spriteTarget: previous?.spriteTarget,
      visualTargetMode: "review",
      design: project.design, designVersion: project.designVersion,
      workshop: snapshotWorkshop(project, project.workshop),
      status: "building",
    });
    await tx.insert(models).values({
      id, projectId: project.id, batchId, name: model.name,
      prompt: `${model.prompt}\n\nRequested change from saved version:\n${change}`,
      parentModelId: model.id, sourceRunId: source.id, changePrompt: change, branchKind: "iterate",
    });
    await tx.insert(jobs).values({
      id: crypto.randomUUID(), kind: "model", targetId: id,
      checkpoint: {
        "branch-references": JSON.stringify([
          ...(source.role === "builder" ? [] : [(source.result as { key: string }).key]),
          ...project.references,
        ]),
      },
    });
    return id;
  });
}
