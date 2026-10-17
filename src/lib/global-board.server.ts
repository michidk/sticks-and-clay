import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { assetEntries, assetVersions, batches, projects, runs } from "@/db/schema";
import type { BoardProject } from "./board-data";

export async function getGlobalBoard(projectId?: string): Promise<{ projects: BoardProject[] }> {
  const projectRows = await db.select({
    id: projects.id, name: projects.name, assetType: projects.assetType,
    designVersion: projects.designVersion, status: projects.status, archivedAt: projects.archivedAt,
  }).from(projects).where(projectId ? eq(projects.id, projectId) : isNull(projects.archivedAt)).orderBy(asc(projects.name));
  const projectIds = projectRows.map((project) => project.id);
  if (!projectIds.length) return { projects: [] };
  const [assetRows, versionRows, batchRows, sourceRows] = await Promise.all([
    db.select().from(assetEntries).where(inArray(assetEntries.projectId, projectIds)).orderBy(desc(assetEntries.createdAt)),
    db.select({ id: assetVersions.id, projectId: assetVersions.projectId, assetId: assetVersions.assetId,
      batchId: assetVersions.batchId, name: assetVersions.name, prompt: assetVersions.prompt,
      parentModelId: assetVersions.parentModelId, branchKind: assetVersions.branchKind,
      status: assetVersions.status, verdict: assetVersions.verdict, visualTarget: assetVersions.visualTarget,
      artifacts: assetVersions.artifacts, createdAt: assetVersions.createdAt, acceptedAt: assetVersions.acceptedAt,
    }).from(assetVersions).where(inArray(assetVersions.projectId, projectIds)).orderBy(desc(assetVersions.createdAt)),
    db.select({ id: batches.id, projectId: batches.projectId, prompt: batches.prompt, status: batches.status, count: batches.count })
      .from(batches).where(inArray(batches.projectId, projectIds)),
    db.select({ id: runs.id, projectId: runs.projectId, modelId: runs.modelId, role: runs.role, status: runs.status })
      .from(runs).where(and(inArray(runs.projectId, projectIds), inArray(runs.role, ["graphic", "svg"]), eq(runs.status, "done"))).orderBy(desc(runs.createdAt)),
  ]);
  return { projects: projectRows.map((project) => {
    const assets = assetRows.filter((asset) => asset.projectId === project.id).map((asset) => ({ ...asset, readyAt: asset.readyAt?.toISOString() ?? null }));
    const activeIds = new Set(assets.filter((asset) => !asset.inIdea).map((asset) => asset.id));
    return {
      project, assets, ideas: assets.filter((asset) => asset.inIdea),
      models: versionRows.filter((version) => version.projectId === project.id && activeIds.has(version.assetId)).map((version) => ({
        ...version, artifacts: version.artifacts ? { image: version.artifacts.image, renders: version.artifacts.renders } : null,
      })),
      batches: batchRows.filter((batch) => batch.projectId === project.id).map((batch) => ({ ...batch, count: batch.count - versionRows.filter((version) => version.batchId === batch.id && !activeIds.has(version.assetId)).length })),
      runs: sourceRows.filter((run) => run.projectId === project.id && ["graphic", "svg"].includes(run.role) && run.status === "done"),
    };
  }) };
}
