import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, models, jobs } from "../db/schema";
import { renderCollection } from "./collection.server";
import { deferInterruptedJob } from "./queue.server";
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

integration.each(["model-quality:3", "model-quality:4"])(
  "shutdown retains %s checkpoint identity and cannot resurrect cancelled jobs",
  async (pipeline) => {
    const id = crypto.randomUUID(),
      run = crypto.randomUUID();
    const checkpoint = {
      pipeline,
      "agent:builder:0": run,
      "agent:photographer:0": crypto.randomUUID(),
      "capability:photographer:0": crypto.randomUUID(),
    };
    // Keep the queue fixture invisible to a concurrently running worker.
    await db.transaction(async (tx) => {
      await tx.insert(jobs).values({
        id,
        kind: "model",
        targetId: crypto.randomUUID(),
        status: "running",
        checkpoint,
      });
      try {
        await deferInterruptedJob(id, tx);
        const [saved] = await tx.select().from(jobs).where(eq(jobs.id, id));
        expect(saved.status).toBe("queued");
        expect(saved.checkpoint).toEqual(checkpoint);
        await tx
          .update(jobs)
          .set({ status: "cancelled" })
          .where(eq(jobs.id, id));
        expect(await deferInterruptedJob(id, tx)).toHaveLength(0);
        const [cancelled] = await tx.select().from(jobs).where(eq(jobs.id, id));
        expect(cancelled.status).toBe("cancelled");
      } finally {
        await tx.delete(jobs).where(eq(jobs.id, id));
      }
    });
  },
);

integration(
  "geometry-only demo jobs finish without publishing a final scene or ending active batches",
  async () => {
    const p = crypto.randomUUID(),
      b = crypto.randomUUID(),
      m = crypto.randomUUID();
    await db
      .insert(projects)
      .values({ id: p, name: "Geometry review fixture", description: "test" });
    await db.insert(batches).values({
      id: b,
      projectId: p,
      prompt: "test",
      count: 1,
      judgeIterations: 2,
      design: "test",
      designVersion: 1,
      status: "building",
    });
    await db.insert(models).values({
      id: m,
      projectId: p,
      batchId: b,
      name: "fixture",
      prompt: "test",
      status: "building",
      artifacts: { stage: "geometry" },
    });
    try {
      await renderCollection(b);
      let [batch] = await db.select().from(batches).where(eq(batches.id, b));
      expect(batch.status).toBe("building");
      await db
        .update(models)
        .set({ status: "done", verdict: "limit_reached" })
        .where(eq(models.id, m));
      await renderCollection(b);
      [batch] = await db.select().from(batches).where(eq(batches.id, b));
      expect(batch.status).toBe("completed_with_errors");
      expect(batch.preview).toBeNull();
    } finally {
      await db.delete(models).where(eq(models.id, m));
      await db.delete(batches).where(eq(batches.id, b));
      await db.delete(projects).where(eq(projects.id, p));
    }
  },
);
