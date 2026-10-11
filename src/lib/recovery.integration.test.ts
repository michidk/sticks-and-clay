import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, jobs, runs, revisions } from "../db/schema";
import { executeJob } from "./pipeline.server";
import { jobContext } from "./checkpoint.server";
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration(
  "completed designer recovery commits once without calling Eve again",
  async () => {
    const projectId = crypto.randomUUID(),
      jobId = crypto.randomUUID(),
      runId = crypto.randomUUID();
    const design =
      "# Recovered design\n" +
      "Warm carved wood with restrained brass details. ".repeat(5);
    await db.insert(projects).values({
      id: projectId,
      name: "Recovery fixture",
      description: "test",
      status: "designing",
    });
    await db.insert(jobs).values({
      id: jobId,
      kind: "design",
      targetId: projectId,
      status: "testing",
      checkpoint: { "agent:designer:0": runId },
    });
    await db.insert(runs).values({
      id: runId,
      projectId,
      role: "designer",
      status: "done",
      model: "fixture",
      promptVersion: "fixture",
      systemPrompt: "fixture",
      input: "fixture",
      result: { design },
      inputTokens: 123,
      outputTokens: 45,
      estimatedCost: 0.001,
      rates: { input: 2, cached: 0.2, output: 10, source: "fixture" },
    });
    try {
      for (let i = 0; i < 2; i++) {
        const [j] = await db.select().from(jobs).where(eq(jobs.id, jobId));
        await jobContext.run({ id: jobId, checkpoint: j.checkpoint }, () =>
          executeJob("design", projectId),
        );
      }
      const [p] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId));
      const history = await db
        .select()
        .from(revisions)
        .where(eq(revisions.projectId, projectId));
      const historyRuns = await db
        .select()
        .from(runs)
        .where(eq(runs.projectId, projectId));
      expect(p.design).toBe(design);
      expect(p.designVersion).toBe(1);
      expect(history).toHaveLength(1);
      expect(historyRuns).toHaveLength(1);
      expect(historyRuns[0].inputTokens).toBe(123);
    } finally {
      await db.delete(revisions).where(eq(revisions.projectId, projectId));
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
);

integration(
  "Resume queues only the latest failed job and preserves its checkpoint",
  async () => {
    const { api } = await import("./api.server");
    const projectId = crypto.randomUUID(),
      oldId = crypto.randomUUID(),
      newId = crypto.randomUUID();
    await db
      .insert(projects)
      .values({
        id: projectId,
        name: "Resume fixture",
        description: "test",
        status: "failed",
      });
    await db.insert(jobs).values([
      {
        id: oldId,
        kind: "design",
        targetId: projectId,
        status: "failed",
        createdAt: new Date(Date.now() - 10000),
      },
      {
        id: newId,
        kind: "design",
        targetId: projectId,
        status: "failed",
        checkpoint: { "agent:designer:0": "saved-run" },
      },
    ]);
    try {
      const resume = () =>
        api(
          new Request(
            `http://localhost/api/projects/${projectId}/retry-design`,
            { method: "POST" },
          ),
        );
      expect((await resume()).status).toBe(200);
      expect((await resume()).status).toBe(400);
      const rows = await db
        .select()
        .from(jobs)
        .where(eq(jobs.targetId, projectId));
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === oldId)?.status).toBe("failed");
      expect(rows.find((r) => r.id === newId)?.checkpoint).toEqual({
        "agent:designer:0": "saved-run",
      });
      expect(rows.find((r) => r.id === newId)?.status).toBe("queued");
    } finally {
      await db.delete(jobs).where(eq(jobs.targetId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
);
