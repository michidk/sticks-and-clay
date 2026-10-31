import { designPalette } from "./pixel-design-palette";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db/client";
import { batches, events, jobs, assetEntries, assetVersions, materialVersions, mockups, projects, revisions, runs } from "../db/schema";
import { cancelJob } from "./queue.server";
import { deleteProjectResources } from "./project-resources.server";
import { assertDesignIdle } from "./design-updates.server";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The brief is the first design, verbatim: no AI processes it until the owner asks to improve or change it. */
export function initialDesign(name: string, description: string) {
  return description.trim() || `# ${name}`;
}

export async function startDesign(tx: Transaction, projectId: string, name: string, description: string) {
  const design = initialDesign(name, description);
  await tx.update(projects).set({
    design,
    designVersion: 1,
    status: "review",
    phase: "Review design",
    progress: 100,
    error: null,
  }).where(eq(projects.id, projectId));
  await tx.insert(revisions).values({
    id: crypto.randomUUID(), projectId, version: 1, content: design, author: "user",
  });
}

/** Accepts the current revision as it is, without writing a duplicate revision. */
export async function approveDesign(projectId: string, version: number) {
  await db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("Project not found");
    await assertDesignIdle(projectId, tx);
    if (project.designVersion !== version || !["review", "ready"].includes(project.status) || !project.design)
      throw new Error("Design changed. Reload before approving.");
    if (project.assetType === "pixel") designPalette(project.design);
    await tx.update(projects).set({ status: "ready", phase: "Ready to build", progress: 100, error: null })
      .where(eq(projects.id, projectId));
    await tx.update(revisions).set({ approved: true })
      .where(and(eq(revisions.projectId, projectId), eq(revisions.version, version)));
  });
}

/** Restoring an old revision writes it as the newest one; it stays approved only if it was before. */
export async function revertDesign(projectId: string, version: number, toVersion: number) {
  await db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("Project not found");
    await assertDesignIdle(projectId, tx);
    if (project.designVersion !== version || !["review", "ready"].includes(project.status))
      throw new Error("Design changed. Reload before reverting.");
    const [target] = await tx.select().from(revisions)
      .where(and(eq(revisions.projectId, projectId), eq(revisions.version, toVersion)));
    if (!target) throw new Error("That design version no longer exists");
    await tx.update(projects).set({
      design: target.content,
      designVersion: version + 1,
      status: target.approved ? "ready" : "review",
      phase: target.approved ? "Ready to build" : "Review design",
      progress: 100,
      error: null,
    }).where(eq(projects.id, projectId));
    await tx.insert(revisions).values({
      id: crypto.randomUUID(), projectId, version: version + 1,
      content: target.content, author: "user", approved: target.approved,
    });
  });
}

export async function setArchived(projectId: string, archived: boolean) {
  const [updated] = await db.update(projects)
    .set({ archivedAt: archived ? new Date() : null })
    .where(eq(projects.id, projectId)).returning({ id: projects.id });
  if (!updated) throw new Error("Project not found");
}

/** Stop owned jobs before removing the project, its history and its files. */
export async function deleteProject(projectId: string) {
  const active = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("Project not found");
    const versions = await tx.select().from(assetVersions).where(eq(assetVersions.projectId, projectId));
    const requests = await tx.select().from(batches).where(eq(batches.projectId, projectId));
    const assets = await tx.select().from(assetEntries).where(eq(assetEntries.projectId, projectId));
    const history = await tx.select().from(runs).where(eq(runs.projectId, projectId));
    const historicalTargets = history.flatMap((r) => [r.modelId, r.batchId]).filter((id): id is string => Boolean(id));
    const targets = [projectId, ...versions.map((v) => v.id), ...requests.map((b) => b.id), ...assets.map((a) => a.id), ...historicalTargets];
    const ownedJobs = await tx.select().from(jobs).where(inArray(jobs.targetId, targets));
    const running = ownedJobs.filter((job) => ["queued", "waiting", "running", "cancelling"].includes(job.status));
    if (running.length) return running;
    if (history.some((run) => run.status === "running"))
      throw new Error("An AI request is still running. Wait for it to finish before deleting this project.");
    const concepts = await tx.select().from(mockups).where(eq(mockups.projectId, projectId));
    const materials = await tx.select().from(materialVersions).where(eq(materialVersions.projectId, projectId));
    const activity = await tx.select().from(events).where(inArray(events.runId, history.map((r) => r.id)));
    const otherProjects = (await tx.select().from(projects)).filter((p) => p.id !== projectId);
    const retained: unknown[] = [(await tx.select().from(jobs)).filter((job) => !targets.includes(job.targetId))];
    for (const table of [assetVersions, batches, assetEntries, mockups, materialVersions, runs]) {
      retained.push((await tx.select().from(table)).filter((row) => row.projectId !== projectId));
    }
    await deleteProjectResources({
      prefixes: [
        ...["project-photographs", "mockups", "exports", "starting-points"].map((root) => `${root}/${projectId}/`),
        ...[...new Set([...versions.map((v) => v.id), ...history.flatMap((r) => r.modelId ? [r.modelId] : [])])].flatMap((id) => ["models", "graphics", "cad"].map((root) => `${root}/${id}/`)),
        ...requests.map((b) => `collections/${b.id}/`),
        ...history.flatMap((r) => [`versions/${r.id}/`, `photographs/${r.id}/`]),
        ...ownedJobs.flatMap((j) => [`materials/${j.id}/`, `presentations/${j.id}/`]),
        ...[
          ...ownedJobs.flatMap((j) => Object.entries(j.checkpoint).filter(([key]) => key.startsWith("capability:")).map(([, value]) => value)),
          ...history.flatMap((r) => [...r.input.matchAll(/Blender capability: ([0-9a-f-]{36})/g)].map((match) => match[1])),
        ].filter((id) => /^[0-9a-f-]{36}$/.test(id)).map((id) => `capabilities/${id}.json`),
      ],
      owned: [project, versions, requests, assets, history, activity, concepts, materials, ownedJobs],
      retained: [otherProjects, retained],
    });
    await tx.delete(events).where(inArray(events.runId, history.map((r) => r.id)));
    await tx.delete(runs).where(eq(runs.projectId, projectId));
    await tx.delete(revisions).where(eq(revisions.projectId, projectId));
    await tx.delete(jobs).where(inArray(jobs.targetId, targets));
    await tx.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
    await tx.delete(assetEntries).where(eq(assetEntries.projectId, projectId));
    await tx.delete(batches).where(eq(batches.projectId, projectId));
    await tx.delete(projects).where(eq(projects.id, projectId));
    return [];
  });
  for (const job of active) {
    const [current] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    if (current && ["queued", "waiting", "running"].includes(current.status)) await cancelJob(current.id);
  }
  return { pending: active.length > 0 };
}

export function assertNotArchived(project: { archivedAt: Date | null }) {
  if (project.archivedAt) throw new Error("This project is archived. Unarchive it to continue.");
}

/** Removes a generated asset and the iterations built on it. Its files and AI request records stay,
 * so cost history is unchanged. Forks are separate collection entries and are kept. Runs inside the
 * caller's transaction so it can combine with other changes. */
export async function deleteAssetIn(tx: Transaction, modelId: string) {
  const [model] = await tx.select().from(assetVersions).where(eq(assetVersions.id, modelId));
  if (!model) throw new Error("Asset not found");
  const [project] = await tx.select().from(projects).where(eq(projects.id, model.projectId)).for("update");
  assertNotArchived(project);
  const all = await tx.select().from(assetVersions).where(eq(assetVersions.projectId, model.projectId));
  const doomed = new Set([model.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const item of all)
      if (!doomed.has(item.id) && item.branchKind === "iterate" && item.parentModelId && doomed.has(item.parentModelId))
        grew = !!doomed.add(item.id);
  }
  const ids = [...doomed];
  const running = all.some((item) => doomed.has(item.id) && !["done", "failed", "cancelled"].includes(item.status));
  const pendingBatches = all.filter((item) => doomed.has(item.id) && !["done", "failed", "cancelled"].includes(item.status)).map((item) => item.batchId);
  const active = await tx.select({ id: jobs.id, status: jobs.status }).from(jobs).where(and(
    or(inArray(jobs.targetId, ids), pendingBatches.length ? and(eq(jobs.kind, "plan"), inArray(jobs.targetId, pendingBatches)) : undefined),
    inArray(jobs.status, ["queued", "waiting", "running", "cancelling"]),
  ));
  if (active.length) return active;
  if (running) throw new Error("This asset is still being generated. Cancel it or wait for it to finish first.");
  await tx.delete(assetVersions).where(inArray(assetVersions.id, ids));
  return [];
}

export async function deleteAsset(modelId: string) {
  const active = await db.transaction((tx) => deleteAssetIn(tx, modelId));
  for (const job of active) if (job.status !== "cancelling") await cancelJob(job.id);
  return { pending: active.length > 0 };
}
