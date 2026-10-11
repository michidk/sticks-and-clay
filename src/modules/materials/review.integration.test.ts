import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { projects, jobs, runs, materialVersions } from "../../db/schema";
import { materialAction, renderMaterial } from "../../lib/materials.server";
import { checkpoint, jobContext } from "../../lib/checkpoint.server";
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

integration(
  "material repair replays paid results and retains independent review issues",
  async () => {
    const projectId = crypto.randomUUID(),
      repairId = crypto.randomUUID();
    await db.insert(projects).values({
      id: projectId,
      name: "Review replay fixture",
      description: "Test",
      design: "Sage paint",
      status: "ready",
    });
    try {
      const response = await materialAction(
        new Request(`http://localhost/api/projects/${projectId}/materials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parameters: { size: 64, recipe: "painted_metal" },
            prompt: "Sparse chips",
            reviewRounds: 1,
          }),
        }),
        ["projects", projectId, "materials"],
      );
      const { id } = await response!.json();
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      const checkpointState = {
        ...job.checkpoint,
        "material:v1:build:0": JSON.stringify({
          script: "def build(params):\n    raise RuntimeError('fixture')",
          notes: "Before repair",
          requirements: [],
        }),
        "step:material:v1:render:0:repair:0": repairId,
        "material:v1:review:0": JSON.stringify({
          passed: true,
          score: 75,
          assessment: "Needs a visible chip boundary",
          findings: [
            {
              severity: "major",
              feature: "chips",
              evidence: "Image 1",
              correction: "Connect the chip edges",
            },
          ],
        }),
      };
      await db.insert(runs).values({
        id: repairId,
        projectId,
        role: "material-builder",
        engine: "tanstack",
        status: "done",
        model: "fixture",
        promptVersion: "fixture",
        systemPrompt: "Saved instructions",
        input: "Saved input",
        rates: { input: 0, output: 0, cached: 0, source: "fixture" },
        result: {
          script:
            "from materialkit import build_material\ndef build(params): return build_material(params)\n",
          notes: "Repaired",
          requirements: [],
        },
      });
      await db
        .update(jobs)
        .set({ status: "running", checkpoint: checkpointState })
        .where(eq(jobs.id, id));
      await jobContext.run({ id, checkpoint: checkpointState }, async () => {
        await Promise.all(
          Array.from({ length: 12 }, (_, i) =>
            checkpoint(`concurrent:${i}`, String(i)),
          ),
        );
        await renderMaterial(projectId);
      });
      const [saved] = await db.select().from(jobs).where(eq(jobs.id, id));
      expect(saved.checkpoint.outcome).toBe("issues");
      expect(saved.checkpoint.reviewed).toBe("yes");
      for (let i = 0; i < 12; i++)
        expect(saved.checkpoint[`concurrent:${i}`]).toBe(String(i));
      const [version] = await db
        .select()
        .from(materialVersions)
        .where(eq(materialVersions.id, id));
      expect(version.outcome).toBe("issues");
      await jobContext.run({ id, checkpoint: saved.checkpoint }, () =>
        renderMaterial(projectId),
      );
      expect(
        await db.select().from(runs).where(eq(runs.projectId, projectId)),
      ).toHaveLength(1);
    } finally {
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(jobs).where(eq(jobs.targetId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
  30000,
);
