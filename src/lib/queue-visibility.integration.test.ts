import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, jobs, runs, revisions } from "../db/schema";
import { api } from "./api.server";
import { runRole, immediateRoles } from "../modules/ai/index.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

test("non-draft AI work cannot bypass the queue", async () => {
  await expect(
    runRole({ role: "designer", projectId: "fixture", input: "fixture" }),
  ).rejects.toThrow("requires a queue job");
});

integration(
  "the queue includes initial design jobs and every immediate draft with its real status",
  async () => {
    const projectId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await db
      .insert(projects)
      .values({ id: projectId, name: "Queue fixture", description: "test" });
    try {
      await db
        .insert(jobs)
        .values({ id: jobId, kind: "design", targetId: projectId });
      for (const role of immediateRoles) {
        await db.insert(runs).values({
          id: crypto.randomUUID(),
          projectId,
          role,
          engine: "tanstack",
          status: role === "project-name" ? "done" : "running",
          model: "fixture",
          promptVersion: "fixture",
          systemPrompt: "fixture",
          input: "fixture",
          rates: { input: 0, output: 0, cached: 0, source: "fixture" },
        });
      }
      const response = await api(new Request("http://localhost/api/queue"));
      expect(response.status).toBe(200);
      const queue = await response.json();
      expect(
        queue.jobs.find((job: { id: string }) => job.id === jobId),
      ).toMatchObject({
        kind: "design",
        name: "Design reference",
        projectId,
        status: "queued",
      });
      for (const role of immediateRoles) {
        expect(
          queue.jobs.find(
            (job: { kind: string; projectId: string }) =>
              job.kind === role && job.projectId === projectId,
          ),
        ).toMatchObject({
          status: role === "project-name" ? "done" : "running",
          canCancel: false,
        });
      }
      expect(queue.control.activeJobs).toBeGreaterThanOrEqual(3);
      const workspace = await (
        await api(new Request(`http://localhost/api/projects/${projectId}`))
      ).json();
      expect(workspace.activeJobs).toHaveLength(4);
      await api(
        new Request("http://localhost/api/queue/cancel-pending", {
          method: "POST",
        }),
      );
      expect(
        (await db.select().from(jobs).where(eq(jobs.id, jobId)))[0].status,
      ).toBe("cancelled");
    } finally {
      await db.delete(jobs).where(eq(jobs.targetId, projectId));
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(revisions).where(eq(revisions.projectId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
);
