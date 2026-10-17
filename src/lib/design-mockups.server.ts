import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { jobs, projects } from "../db/schema";
import { runImageRole } from "../modules/ai/index.server";
import { checkpoint, jobContext } from "./checkpoint.server";
import { mockupInput, mockupImage, mockupSnapshot } from "./design-mockups";
import { prompt } from "./prompts.server";
import { assertJobActive } from "./queue.server";
import type { z } from "zod";

export async function queueDesignMockups(projectId: string, input: z.infer<typeof mockupInput>) {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects)
      .where(eq(projects.id, projectId)).for("update");
    if (!project || project.status !== "ready")
      throw new Error("Approve the design before generating mockups");
    if (project.designVersion !== input.version)
      throw new Error("Design changed. Reload before generating mockups.");
    const [active] = await tx.select().from(jobs).where(and(
      eq(jobs.kind, "design-mockups"),
      eq(jobs.targetId, projectId),
      inArray(jobs.status, ["queued", "running", "cancelling"]),
    ));
    if (active) return active.id;
    const prompts = await Promise.all(Array.from({ length: input.count }, (_, index) =>
      prompt("design-mockup", {
        name: project.name,
        description: project.description,
        design: project.design,
        assetType: project.assetType !== "model" ? "2D graphics" : "3D assets",
        request: input.hint || "Choose a useful example from the design reference.",
        variation: index + 1,
        count: input.count,
      }),
    ));
    const id = crypto.randomUUID();
    await tx.insert(jobs).values({
      id,
      kind: "design-mockups",
      targetId: projectId,
      checkpoint: { input: JSON.stringify({ version: input.version, references: project.references, prompts }) },
    });
    return id;
  });
}

export async function designMockups(projectId: string) {
  const list = await db.select().from(jobs).where(and(
    eq(jobs.kind, "design-mockups"), eq(jobs.targetId, projectId),
  )).orderBy(desc(jobs.createdAt));
  return list.map((job) => {
    const input = mockupSnapshot.parse(JSON.parse(job.checkpoint.input));
    return {
      id: job.id,
      status: job.status,
      error: job.error,
      createdAt: job.createdAt,
      version: input.version,
      count: input.prompts.length,
      images: input.prompts.flatMap((_, index) => {
        const saved = job.checkpoint[`mockup:${index}`];
        return saved ? [mockupImage.parse(JSON.parse(saved))] : [];
      }),
    };
  });
}

export async function generateDesignMockups(projectId: string) {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  const input = mockupSnapshot.parse(JSON.parse(job.checkpoint.input));
  for (const [index, text] of input.prompts.entries()) {
    await assertJobActive();
    const key = `mockup:${index}`;
    if (job.checkpoint[key]) continue;
    const image = await runImageRole({
      role: "design-mockup",
      name: `mockup-${index + 1}`,
      stepId: key,
      prompt: text,
      projectId,
      directory: `mockups/${projectId}/${job.id}`,
      size: "1536x1024",
      images: input.references,
      assertActive: assertJobActive,
    });
    await assertJobActive();
    await checkpoint(key, JSON.stringify({ key: image.key, runId: image.runId }));
  }
  await checkpoint("applied", "yes");
}
