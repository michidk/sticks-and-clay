import { db, sql } from "../src/db/client";
import { jobs } from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import {
  assertJobActive,
  cancelJob,
  finishCancellation,
  deferInterruptedJob,
} from "../src/lib/queue.server";
import { executeJob, failJob } from "../src/lib/pipeline.server";
import { adoptLegacyJobs } from "../src/lib/legacy-recovery.server";
import { jobContext } from "../src/lib/checkpoint.server";
import { loadRuntimeSettings } from "../src/lib/runtime-settings.server";
import { laneCanClaim, writeWorkerHeartbeat } from "../src/lib/worker-control.server";
// One coordinator with bounded parallel model workers. Advisory lock survives connection pooling via reserved connection.
const lock = await sql.reserve();
const [acquired] = await lock`select pg_try_advisory_lock(91340851) as ok`;
if (!acquired.ok) throw new Error("An Asset Studio worker is already running");
await adoptLegacyJobs();
for (const job of await db
  .select()
  .from(jobs)
  .where(eq(jobs.status, "cancelling"))) {
  try {
    await cancelJob(job.id);
    await finishCancellation({
      id: job.id,
      kind: job.kind,
      targetId: job.targetId,
    });
  } catch (error) {
    console.error("Cancellation still pending", job.id, String(error));
  }
}
// Re-adopt interrupted jobs; Eve retains their sessions and tool checkpoints.
await db
  .update(jobs)
  .set({ status: "queued", error: null, finishedAt: null })
  .where(eq(jobs.status, "running"));
let stopping = false;
const activeJobs = new Set<string>();
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function heartbeat() {
  try {
    await writeWorkerHeartbeat(activeJobs.size);
  } catch (error) {
    console.error("Worker heartbeat failed", String(error));
  }
}
const heartbeatTimer = setInterval(() => void heartbeat(), 2_500);
await heartbeat();

async function lane(laneIndex: number) {
  while (!stopping) {
    const { queue } = await loadRuntimeSettings();
    if (!laneCanClaim(laneIndex, queue)) {
      await Bun.sleep(1000);
      continue;
    }
    const [job] =
      await sql`update jobs set status='running', "startedAt"=now() where id=(select id from jobs where status='queued' order by created_at for update skip locked limit 1) returning *`;
    if (job && stopping) {
      await deferInterruptedJob(job.id);
      break;
    }
    if (!job) {
      await Bun.sleep(1000);
      continue;
    }
    activeJobs.add(job.id);
    await heartbeat();
    try {
      await jobContext.run(
        { id: job.id, checkpoint: job.checkpoint || {} },
        async () => {
          await assertJobActive();
          await executeJob(job.kind, job.targetId);
          await assertJobActive();
        },
      );
      const finished = await db
        .update(jobs)
        .set({ status: "done", finishedAt: new Date() })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")))
        .returning();
      if (!finished.length)
        await finishCancellation({
          id: job.id,
          kind: job.kind,
          targetId: job.targetId,
        });
    } catch (error) {
      const [current] = await db.select().from(jobs).where(eq(jobs.id, job.id));
      if (current && ["cancelling", "cancelled"].includes(current.status)) {
        await finishCancellation(current);
        continue;
      }
      if (stopping) {
        await deferInterruptedJob(job.id);
        continue;
      }
      console.error("Job failed", job.id, String(error));
      await failJob(job.kind, job.targetId, String(error));
      await db
        .update(jobs)
        .set({ status: "failed", error: String(error), finishedAt: new Date() })
        .where(eq(jobs.id, job.id));
    } finally {
      activeJobs.delete(job.id);
      await heartbeat();
    }
  }
}
console.log("Asset Studio worker ready");
await Promise.all(Array.from({ length: 4 }, (_, index) => lane(index)));
clearInterval(heartbeatTimer);
await heartbeat();
await lock`select pg_advisory_unlock(91340851)`;
lock.release();
await sql.end();
