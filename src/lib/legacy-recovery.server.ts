import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db/client";
import { jobs, runs } from "../db/schema";

/** Adopt pre-checkpoint jobs without changing their saved prompts or workspaces. */
export async function adoptLegacyJobs() {
  const list = await db.select().from(jobs).orderBy(desc(jobs.createdAt));
  const seen = new Set<string>();
  for (const job of list) {
    const key = job.kind + ":" + job.targetId;
    if (seen.has(key)) continue;
    seen.add(key);
    if (job.status === "done" || Object.keys(job.checkpoint).length) continue;
    const match =
      job.kind === "design"
        ? and(eq(runs.projectId, job.targetId), eq(runs.role, "designer"))
        : job.kind === "plan"
          ? and(eq(runs.batchId, job.targetId), eq(runs.role, "planner"))
          : job.kind === "model"
            ? eq(runs.modelId, job.targetId)
            : undefined;
    if (!match) continue;
    const history = await db
      .select()
      .from(runs)
      .where(and(match, gte(runs.createdAt, job.createdAt)))
      .orderBy(runs.createdAt);
    const checkpoint: Record<string, string> = {};
    for (const run of history) {
      checkpoint[`agent:${run.role}:${run.iteration}`] = run.id;
      if (run.role === "builder") {
        const capability = run.input.match(/Blender capability: ([^\s]+)/)?.[1];
        const attempt = run.input.match(
          /Output directory: .*\/models\/[^/]+\/([^/]+)\/iteration-\d+/,
        )?.[1];
        if (capability) checkpoint[`capability:${run.iteration}`] = capability;
        if (attempt) checkpoint.workspace = attempt;
      }
    }
    if (history.length)
      await db.update(jobs).set({ checkpoint }).where(eq(jobs.id, job.id));
  }
}
