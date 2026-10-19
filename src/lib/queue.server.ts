import { evePassword } from "./eve-config.server";
import { and, desc, eq, inArray, ne, notExists, or } from "drizzle-orm";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DATA } from "./storage.server";
import { Client } from "eve/client";
import { db } from "../db/client";
import { jobs, assetEntries, assetVersions, batches, runs, projects } from "../db/schema";
import { jobContext } from "./checkpoint.server";
export class JobWaiting extends Error {}

export class JobCancelled extends Error {
  constructor() {
    super("Cancelled by user");
  }
}
export async function assertJobActive() {
  const context = jobContext.getStore();
  if (!context) return;
  const [job] = await db
    .select({ status: jobs.status })
    .from(jobs)
    .where(eq(jobs.id, context.id));
  if (!job || ["cancelling", "cancelled"].includes(job.status))
    throw new JobCancelled();
}
/** Reserved versions have no builder job until their planner succeeds. */
export function plannerReservations(batchId: string) {
  return and(eq(assetVersions.batchId, batchId), notExists(
    db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.kind, "model"), eq(jobs.targetId, assetVersions.id))),
  ));
}
/** An asset whose only attempts were cancelled goes back to Ideas (still Ready if it was). A later
 * attempt needs nothing: the board shows the asset's newest uncancelled version. */
async function returnToIdeas(assetIds: string[]) {
  for (const id of assetIds) {
    const [kept] = await db.select({ id: assetVersions.id }).from(assetVersions)
      .where(and(eq(assetVersions.assetId, id), ne(assetVersions.status, "cancelled"))).limit(1);
    if (!kept) await db.update(assetEntries).set({ inIdea: true, batchId: null }).where(eq(assetEntries.id, id));
  }
}
export async function finishCancellation(
  job: Pick<typeof jobs.$inferSelect, "id" | "kind" | "targetId">,
) {
  await db
    .update(jobs)
    .set({
      status: "cancelled",
      error: "Cancelled by user",
      finishedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
  if (job.kind === "model") {
    const [m] = await db
      .update(assetVersions)
      .set({ status: "cancelled", phase: "Cancelled by user", error: null })
      .where(eq(assetVersions.id, job.targetId))
      .returning();
    if (m) {
      await returnToIdeas([m.assetId]);
      const siblings = await db
        .select()
        .from(assetVersions)
        .where(eq(assetVersions.batchId, m.batchId));
      if (
        siblings.every((s) =>
          ["done", "failed", "cancelled"].includes(s.status),
        )
      )
        await db
          .update(batches)
          .set({ status: "completed_with_errors" })
          .where(eq(batches.id, m.batchId));
    }
  } else if (["plan", "demo"].includes(job.kind)) {
    if (job.kind === "plan") await returnToIdeas((await db.update(assetVersions)
      .set({ status: "cancelled", phase: "Planning cancelled", error: null })
      .where(plannerReservations(job.targetId)).returning({ assetId: assetVersions.assetId })).map((v) => v.assetId));
    await db
      .update(batches)
      .set({ status: "cancelled", error: "Cancelled by user" })
      .where(eq(batches.id, job.targetId));
  } else if (job.kind === "design")
    await db
      .update(projects)
      .set({
        status: "failed",
        phase: "Setup cancelled",
        error: "Cancelled by user",
      })
      .where(eq(projects.id, job.targetId));
}
export async function cancelJob(id: string, queuedOnly = false) {
  const [queued] = await db
    .update(jobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(jobs.id, id), inArray(jobs.status, queuedOnly ? ["queued"] : ["queued", "waiting"])))
    .returning();
  if (queued) {
    await finishCancellation(queued);
    return "cancelled";
  }
  if (queuedOnly) return "already_started";
  const [active] = await db
    .update(jobs)
    .set({ status: "cancelling" })
    .where(
      and(eq(jobs.id, id), inArray(jobs.status, ["running", "cancelling"])),
    )
    .returning();
  if (!active) throw new Error("This job is no longer active");
  if (active.kind === "design-mockups") return "cancelling";
  if (active.kind === "plan") {
    const children = await db
      .select({ id: assetVersions.id })
      .from(assetVersions)
      .where(eq(assetVersions.batchId, active.targetId));
    if (children.length) {
      const childJobs = await db
        .select()
        .from(jobs)
        .where(
          and(
            inArray(
              jobs.targetId,
              children.map((m) => m.id),
            ),
            inArray(jobs.status, ["queued", "running", "cancelling"]),
          ),
        );
      for (const child of childJobs) await cancelJob(child.id);
    }
  }
  const checkpointIds = Object.entries(active.checkpoint)
    .filter(([key]) => key.startsWith("agent:"))
    .map(([, value]) => value);
  const history = checkpointIds.length
    ? await db.select().from(runs).where(inArray(runs.id, checkpointIds))
    : await db
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.status, "running"),
            active.kind === "model"
              ? eq(runs.modelId, active.targetId)
              : active.kind === "design"
                ? eq(runs.projectId, active.targetId)
                : eq(runs.batchId, active.targetId),
          ),
        );
  const capabilities = new Set([
    ...Object.entries(active.checkpoint)
      .filter(([key]) => key.startsWith("capability:"))
      .map(([, value]) => value),
    ...history
      .map((r) => r.input.match(/Blender capability: ([^\s]+)/)?.[1])
      .filter((v): v is string => Boolean(v)),
  ]);
  for (const capability of capabilities) {
    if (!/^[0-9a-f-]{36}$/.test(capability)) continue;
    const path = resolve(DATA, "capabilities", capability + ".json");
    try {
      const info = JSON.parse(await readFile(path, "utf8"));
      await writeFile(path, JSON.stringify({ ...info, cancelled: true }));
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const client = new Client({
    host: process.env.EVE_URL || "http://127.0.0.1:33441",
    auth: {
      basic: {
        username: "studio",
        password: evePassword(),
      },
    },
  });
  for (const run of history)
    if (run.sessionId && run.status === "running")
      await client.sessions.attach(run.sessionId).cancel();
  return "cancelling";
}

/** Stops whatever is generating a version (its build, or the planner of its request) or a request's planner. */
export async function abortGeneration(batchId: string, versionId?: string) {
  const [job] = await db.select({ id: jobs.id }).from(jobs).where(and(
    inArray(jobs.status, ["queued", "waiting", "running", "cancelling"]),
    or(and(eq(jobs.kind, "plan"), eq(jobs.targetId, batchId)),
      versionId ? and(eq(jobs.kind, "model"), eq(jobs.targetId, versionId)) : undefined),
  )).orderBy(desc(jobs.createdAt)).limit(1);
  if (!job) throw new Error("Nothing is generating here");
  return cancelJob(job.id);
}

/** Service shutdown is a recoverable interruption, not a failed asset attempt. */
export async function deferInterruptedJob(
  id: string,
  database: Pick<typeof db, "update"> = db,
) {
  return database
    .update(jobs)
    .set({ status: "queued", error: null, finishedAt: null })
    .where(and(eq(jobs.id, id), eq(jobs.status, "running")))
    .returning({ id: jobs.id });
}
