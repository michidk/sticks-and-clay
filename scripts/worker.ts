import { db, sql } from "../src/db/client";
import { jobs, runs } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { executeJob, failJob } from "../src/lib/pipeline.server";
import { Client } from "eve/client";
// One coordinator with bounded parallel model workers. Advisory lock survives connection pooling via reserved connection.
const lock = await sql.reserve();
const [acquired] = await lock`select pg_try_advisory_lock(91340851) as ok`;
if (!acquired.ok) throw new Error("An Asset Studio worker is already running");
for (const run of await db
  .select()
  .from(runs)
  .where(eq(runs.status, "running"))) {
  if (run.sessionId)
    await new Client({
      host: process.env.EVE_URL || "http://127.0.0.1:33441",
      auth: {
        basic: {
          username: "studio",
          password: process.env.EVE_PASSWORD || "studio-local-agent",
        },
      },
    }).sessions
      .attach(run.sessionId)
      .cancel({ tasks: true })
      .catch(() => {});
  await db
    .update(runs)
    .set({
      status: "failed",
      error: "Worker restarted; previous turn cancelled",
      finishedAt: new Date(),
    })
    .where(eq(runs.id, run.id));
}
for (const job of await db
  .select()
  .from(jobs)
  .where(eq(jobs.status, "running"))) {
  await failJob(job.kind, job.targetId, "Worker restarted. Run interrupted.");
  await db
    .update(jobs)
    .set({
      status: "failed",
      error: "Worker restarted",
      finishedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
}
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
      await executeJob(job.kind, job.targetId);
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
