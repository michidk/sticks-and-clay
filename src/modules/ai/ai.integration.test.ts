import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { projects, runs, jobs } from "../../db/schema";
import { jobContext } from "../../lib/checkpoint.server";
import { runRole } from "./index.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration(
  "both engines replay completed checkpoints without requests or duplicated cost",
  async () => {
    const projectId = crypto.randomUUID();
    await db
      .insert(projects)
      .values({
        id: projectId,
        name: "AI boundary fixture",
        description: "test",
      });
    const jobId = crypto.randomUUID();
    await db
      .insert(jobs)
      .values({
        id: jobId,
        kind: "model",
        targetId: projectId,
        status: "done",
      });
    try {
      for (const engine of ["tanstack", "eve"] as const) {
        const id = crypto.randomUUID();
        const role = engine === "tanstack" ? "designer" : "builder";
        const result =
          role === "designer"
            ? { design: "Design ".repeat(30) }
            : { summary: "Built", limitations: [] };
        await db
          .insert(runs)
          .values({
            id,
            projectId,
            role,
            engine,
            status: "done",
            sessionId: engine === "eve" ? "retained-session" : null,
            model: "fixture",
            promptVersion: "fixture",
            systemPrompt: "fixture",
            input: "fixture",
            result,
            inputTokens: 100,
            outputTokens: 20,
            estimatedCost: 0.123,
            rates: { input: 2, cached: 0.2, output: 10, source: "fixture" },
          });
        const key = engine === "eve" ? "agent:builder:0" : "direct:designer";
        await jobContext.run(
          { id: jobId, checkpoint: { [key]: id } },
          async () => {
            for (let attempt = 0; attempt < 2; attempt++)
              expect(
                await runRole({
                  role,
                  projectId,
                  input: "replacement must not execute",
                }),
              ).toEqual({ result, runId: id });
            await expect(
              runRole({ role, projectId: "wrong-project", input: "wrong" }),
            ).rejects.toThrow("different task");
          },
        );
        const [saved] = await db.select().from(runs).where(eq(runs.id, id));
        expect(saved.estimatedCost).toBe(0.123);
        expect(saved.inputTokens).toBe(100);
        expect(saved.sessionId).toBe(
          engine === "eve" ? "retained-session" : null,
        );
      }
    } finally {
      await db.delete(jobs).where(eq(jobs.id, jobId));
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
);
