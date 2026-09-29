import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { jobs } from "../db/schema";
import { cancelJob, assertJobActive, JobCancelled } from "./queue.server";
import { jobContext } from "./checkpoint.server";
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration(
  "pending cancellation persists and prevents recovered execution",
  async () => {
    const id = crypto.randomUUID();
    await db
      .insert(jobs)
      .values({
        id,
        kind: "queue-test",
        targetId: crypto.randomUUID(),
        status: "queued",
      });
    try {
      expect(await cancelJob(id, true)).toBe("cancelled");
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      expect(job.status).toBe("cancelled");
      await expect(
        jobContext.run({ id, checkpoint: {} }, () => assertJobActive()),
      ).rejects.toBeInstanceOf(JobCancelled);
    } finally {
      await db.delete(jobs).where(eq(jobs.id, id));
    }
  },
);
integration(
  "abort pending cannot stop a job that was already claimed",
  async () => {
    const id = crypto.randomUUID();
    await db
      .insert(jobs)
      .values({
        id,
        kind: "queue-test",
        targetId: crypto.randomUUID(),
        status: "running",
      });
    try {
      expect(await cancelJob(id, true)).toBe("already_started");
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      expect(job.status).toBe("running");
    } finally {
      await db.delete(jobs).where(eq(jobs.id, id));
    }
  },
);
