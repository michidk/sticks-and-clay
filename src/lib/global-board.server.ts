import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { assetEntries, assetHistory, assetVersions, batches, projects, runs } from "@/db/schema";
import type { BoardProject } from "./board-data";
import { collectionAssetGroups } from "./project-summary";
import { loadRuntimeSettings } from "./runtime-settings.server";

export async function getGlobalBoard(projectId?: string): Promise<{ projects: BoardProject[] }> {
  const { boardDoneHideAfterDays } = await loadRuntimeSettings();
  const cutoff = Date.now() - boardDoneHideAfterDays * 24 * 60 * 60 * 1000;
  const projectRows = await db.select({
    id: projects.id, name: projects.name, assetType: projects.assetType,
    designVersion: projects.designVersion, status: projects.status, archivedAt: projects.archivedAt,
  }).from(projects).where(projectId ? eq(projects.id, projectId) : isNull(projects.archivedAt)).orderBy(asc(projects.name));
  const projectIds = projectRows.map((project) => project.id);
  if (!projectIds.length) return { projects: [] };
  const latestUpdates = db.select({ assetId: assetHistory.assetId, updatedAt: max(assetHistory.createdAt).as("updated_at") })
    .from(assetHistory).groupBy(assetHistory.assetId).as("latest_updates");
  const [assetRows, versionRows, batchRows, sourceRows] = await Promise.all([
    db.select().from(assetEntries).where(inArray(assetEntries.projectId, projectIds)).orderBy(desc(assetEntries.createdAt)),
    db.select({ id: assetVersions.id, projectId: assetVersions.projectId, assetId: assetVersions.assetId,
      batchId: assetVersions.batchId, name: assetVersions.name, prompt: assetVersions.prompt,
      parentModelId: assetVersions.parentModelId, branchKind: assetVersions.branchKind,
      status: assetVersions.status, verdict: assetVersions.verdict, visualTarget: assetVersions.visualTarget,
      lastUpdatedAt: sql<Date>`greatest(${assetVersions.createdAt}, ${assetVersions.acceptedAt}, ${latestUpdates.updatedAt})`.mapWith(assetVersions.createdAt),
      artifacts: assetVersions.artifacts, createdAt: assetVersions.createdAt, acceptedAt: assetVersions.acceptedAt,
    }).from(assetVersions).leftJoin(latestUpdates, eq(latestUpdates.assetId, assetVersions.assetId)).where(inArray(assetVersions.projectId, projectIds)).orderBy(desc(assetVersions.createdAt)),
    db.select({ id: batches.id, projectId: batches.projectId, prompt: batches.prompt, status: batches.status, count: batches.count })
      .from(batches).where(inArray(batches.projectId, projectIds)),
    db.select({ id: runs.id, projectId: runs.projectId, modelId: runs.modelId, role: runs.role, status: runs.status })
      .from(runs).where(and(inArray(runs.projectId, projectIds), inArray(runs.role, ["graphic", "svg", "pixel"]), eq(runs.status, "done"))).orderBy(desc(runs.createdAt)),
  ]);
  const hiddenVersionIds = new Set(boardDoneHideAfterDays === 0 ? [] : collectionAssetGroups(versionRows)
    .filter(({ representative }) => representative.status === "done" && representative.acceptedAt && representative.lastUpdatedAt.getTime() < cutoff)
    .flatMap(({ assets }) => assets.map((version) => version.id)));
  return { projects: projectRows.map((project) => {
    const assets = assetRows.filter((asset) => asset.projectId === project.id).map((asset) => ({ ...asset, readyAt: asset.readyAt?.toISOString() ?? null }));
    const activeIds = new Set(assets.filter((asset) => !asset.inIdea).map((asset) => asset.id));
    return {
      project, assets, ideas: assets.filter((asset) => asset.inIdea),
      models: versionRows.filter((version) => version.projectId === project.id && activeIds.has(version.assetId) && !hiddenVersionIds.has(version.id)).map((version) => ({
        ...version, artifacts: version.artifacts ? { image: version.artifacts.image, renders: version.artifacts.renders } : null,
      })),
      batches: batchRows.filter((batch) => batch.projectId === project.id).map((batch) => ({ ...batch, count: batch.count - versionRows.filter((version) => version.batchId === batch.id && (!activeIds.has(version.assetId) || hiddenVersionIds.has(version.id))).length })),
      runs: sourceRows.filter((run) => run.projectId === project.id && ["graphic", "svg", "pixel"].includes(run.role) && run.status === "done"),
    };
  }) };
}
