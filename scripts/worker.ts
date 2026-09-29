import { db, sql } from "../src/db/client";
import { jobs } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { executeJob, failJob } from "../src/lib/pipeline.server";
import { adoptLegacyJobs } from "../src/lib/legacy-recovery.server";
import { jobContext } from "../src/lib/checkpoint.server";
// One coordinator with bounded parallel model workers. Advisory lock survives connection pooling via reserved connection.
const lock = await sql.reserve();
const [acquired] = await lock`select pg_try_advisory_lock(91340851) as ok`;
if (!acquired.ok) throw new Error("An Asset Studio worker is already running");
await adoptLegacyJobs();
// Re-adopt interrupted jobs; Eve retains their sessions and tool checkpoints.
await db
  .update(jobs)
  .set({ status: "queued", error: null, finishedAt: null })
  .where(eq(jobs.status, "running"));
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function lane() {
  while (!stopping) {
    const [job] =
      await sql`update jobs set status='running', "startedAt"=now() where id=(select id from jobs where status='queued' order by created_at for update skip locked limit 1) returning *`;
    if (!job) {
      await Bun.sleep(1000);
      continue;
    }
    try {
      await jobContext.run(
        { id: job.id, checkpoint: job.checkpoint || {} },
        () => executeJob(job.kind, job.targetId),
      );
      await db
        .update(jobs)
        .set({ status: "done", finishedAt: new Date() })
        .where(eq(jobs.id, job.id));
    } catch (error) {
      console.error("Job failed", job.id, String(error));
      await failJob(job.kind, job.targetId, String(error));
      await db
        .update(jobs)
        .set({ status: "failed", error: String(error), finishedAt: new Date() })
        .where(eq(jobs.id, job.id));
    }
  }
}
console.log("Asset Studio worker ready");
await Promise.all(
  Array.from(
    {
      length: Math.max(
        1,
        Math.min(4, Number(process.env.WORKER_CONCURRENCY || 2)),
      ),
    },
    lane,
  ),
);
await lock`select pg_advisory_unlock(91340851)`;
lock.release();
await sql.end();
