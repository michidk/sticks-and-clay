import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { batches, events, jobs, models, projects, revisions, runs } from "../db/schema";
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

/** Only setup-stage projects can be removed; anything with generated work is archived instead. */
export async function deleteProject(projectId: string) {
  await db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new Error("Project not found");
    const [{ assets }] = await tx.select({ assets: count() }).from(models).where(eq(models.projectId, projectId));
    const [{ requests }] = await tx.select({ requests: count() }).from(batches).where(eq(batches.projectId, projectId));
    if (assets || requests)
      throw new Error("This project has generated work. Archive it instead of deleting it.");
    const [active] = await tx.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.targetId, projectId), inArray(jobs.status, ["queued", "running", "cancelling"]),
    ));
    if (active) throw new Error("Stop the running work before deleting this project.");
    const owned = tx.select({ id: runs.id }).from(runs).where(eq(runs.projectId, projectId));
    await tx.delete(events).where(inArray(events.runId, owned));
    await tx.delete(runs).where(eq(runs.projectId, projectId));
    await tx.delete(revisions).where(eq(revisions.projectId, projectId));
    await tx.delete(jobs).where(eq(jobs.targetId, projectId));
    await tx.delete(projects).where(eq(projects.id, projectId));
  });
}

export function assertNotArchived(project: { archivedAt: Date | null }) {
  if (project.archivedAt) throw new Error("This project is archived. Unarchive it to continue.");
}
