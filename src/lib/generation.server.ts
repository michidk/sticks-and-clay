import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, assetVersions, assetEntries, projects, runs } from "../db/schema";
import type { GenerationInput } from "./api-inputs";
import { flatRoles } from "./asset-types";
import { assertNotArchived } from "./project-lifecycle.server";
import { assetSnapshot } from "./asset-snapshot.server";
import { snapshotWorkshop } from "./workshop.server";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function validateGeneration(project: typeof projects.$inferSelect, input: GenerationInput) {
  if (project.assetType !== "model" && input.spriteTarget)
    throw new Error("Sprite targets require a 3D collection");
  if (project.assetType === "model" && input.imageSize !== "1024x1024")
    throw new Error("Image size applies only to graphic projects");
}

/** The stand-in name given to each asset of a request that has no title of its own, until the planner names them. */
export const placeholderTitle = (prompt: string) => prompt.split("\n")[0].slice(0, 100) || "Asset";

export async function insertGeneration(tx: Transaction, project: typeof projects.$inferSelect, input: GenerationInput, asset?: typeof assetEntries.$inferSelect) {
  if (project.status !== "ready")
    throw new Error("Approve the design before generating assets");
  assertNotArchived(project);
  validateGeneration(project, input);
  const id = crypto.randomUUID();
  const workshop = asset ? assetSnapshot(project, asset) : { ...snapshotWorkshop(project, project.workshop), ...(input.parts ? { parts: input.parts } : {}) };
  await tx.insert(batches).values({
    id, projectId: project.id, ...input,
    visualTargetMode: input.visualTargetMode ?? "review",
    design: project.design, designVersion: project.designVersion, workshop,
  });
  if (!asset) {
    for (let index = 0; index < input.count; index++) {
      const assetId = crypto.randomUUID();
      const prompt = input.prompt || project.design;
      const name = placeholderTitle(prompt);
      await tx.insert(assetEntries).values({ id: assetId, projectId: project.id, title: name, input: { ...input, prompt, count: 1 }, batchId: id, inIdea: false });
      await tx.insert(assetVersions).values({ id: crypto.randomUUID(), assetId, projectId: project.id, batchId: id, name, prompt });
    }
  }
  if (asset) {
    await tx.update(assetEntries).set({ batchId: id, inIdea: false }).where(eq(assetEntries.id, asset.id));
    await tx.insert(assetVersions).values({ id: crypto.randomUUID(), assetId: asset.id, projectId: project.id, batchId: id, name: asset.title || "Asset", prompt: input.prompt });
  }
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
    const [model] = await tx.select().from(assetVersions).where(eq(assetVersions.id, modelId));
    if (!model) throw new Error("Asset not found");
    const [project] = await tx.select().from(projects).where(eq(projects.id, model.projectId)).for("update");
    if (!project || project.status !== "ready")
      throw new Error("Approve the design before generating assets");
    assertNotArchived(project);
    const saved = await tx.select().from(runs).where(and(
      eq(runs.modelId, modelId), eq(runs.status, "done"), inArray(runs.role, ["builder", ...flatRoles]),
    )).orderBy(desc(runs.createdAt));
    const source = saved.find((run) => {
      const result = run.result as { key?: string; artifacts?: { blend?: string } } | null;
      return run.role === "builder" ? result?.artifacts?.blend : result?.key;
    });
    if (!source) throw new Error("This asset has no saved version to build on");
    const [asset] = await tx.select().from(assetEntries).where(eq(assetEntries.id, model.assetId)).for("update");
    const workshop = assetSnapshot(project, asset);
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
      workshop,
      status: "building",
    });
    await tx.insert(assetVersions).values({
      id, assetId: model.assetId, projectId: project.id, batchId, name: asset.title || model.name,
      prompt: `${model.prompt}\n\nRequested change from saved version:\n${change}`,
      parentModelId: model.id, sourceRunId: source.id, changePrompt: change, branchKind: "iterate",
    });
    await tx.insert(jobs).values({
      id: crypto.randomUUID(), kind: "model", targetId: id,
      checkpoint: {
        "branch-references": JSON.stringify([
          ...(source.role === "builder" ? [] : [(source.result as { key: string }).key]),
          ...(workshop.references || []),
        ]),
      },
    });
    return id;
  });
}
