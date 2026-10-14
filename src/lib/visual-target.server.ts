import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../db/client";
import { batches, jobs, models, projects } from "../db/schema";
import { runImageRole } from "../modules/ai/index.server";
import { visualTargetDecisionInput } from "./api-inputs";
import { checkpoint, jobContext } from "./checkpoint.server";
import { prompt } from "./prompts.server";
import { assertJobActive, JobCancelled, JobWaiting } from "./queue.server";

export async function prepareVisualTarget({ model, batch, project, request, attempt, legacy }: {
  model: typeof models.$inferSelect;
  batch: typeof batches.$inferSelect;
  project: typeof projects.$inferSelect;
  request: string;
  attempt: string;
  legacy: boolean;
}) {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  const references: string[] = job.checkpoint["visual-target-input"]
    ? JSON.parse(job.checkpoint["visual-target-input"]).images
    : job.checkpoint["branch-references"] ? JSON.parse(job.checkpoint["branch-references"]) : project.references;
  if (legacy)
    return { target: model.visualTarget, visualReferences: references };
  if (batch.visualTargetMode === "skip")
    return { target: null, visualReferences: references };
  const revision = Number(job.checkpoint["visual-target-revision"] || 0);
  const key = revision ? `visual-target:${revision}` : "visual-target";
  const inputKey = `${key}-input`;
  let target = job.checkpoint[key];
  if (!target) {
    await db.update(models).set({ status: "building", phase: revision ? "Revising visual target" : "Creating visual target", progress: 2 }).where(eq(models.id, model.id));
    if (!job.checkpoint[inputKey]) {
      const base = await prompt("visual-target", { design: batch.design, name: model.name, request });
      await checkpoint(inputKey, JSON.stringify({
        prompt: revision ? `${base}\n\nRevise the previous visual target according to this feedback:\n${job.checkpoint[`${key}-feedback`]}` : base,
        images: revision && model.visualTarget ? [...references, model.visualTarget] : references,
      }));
    }
    const input = JSON.parse(job.checkpoint[inputKey]);
    const concept = await runImageRole({
      role: "visual-target", name: revision ? `visual-target-revision-${revision}` : "visual-target", stepId: key, iteration: revision,
      projectId: model.projectId, batchId: batch.id, modelId: model.id,
      directory: `models/${model.id}/${attempt}/concept`,
      prompt: input.prompt, images: input.images, assertActive: assertJobActive,
    });
    target = concept.key;
    await checkpoint(key, target);
  }
  await assertJobActive();
  if (batch.visualTargetMode === "review" && job.checkpoint["visual-target-approved"] !== target) {
    await db.transaction(async (tx) => {
      const [waiting] = await tx.update(jobs).set({ status: "waiting" })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"))).returning({ id: jobs.id });
      if (!waiting) throw new JobCancelled();
      await tx.update(models).set({ visualTarget: target, status: "awaiting_approval", phase: "Review visual target", progress: 5, error: null }).where(eq(models.id, model.id));
    });
    throw new JobWaiting("Visual target awaits approval");
  }
  await db.update(models).set({ visualTarget: target }).where(eq(models.id, model.id));
  const visualReferences: string[] = job.checkpoint[inputKey] ? JSON.parse(job.checkpoint[inputKey]).images : references;
  return { target, visualReferences };
}

export async function decideVisualTarget(modelId: string, decision: z.infer<typeof visualTargetDecisionInput>) {
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.kind, "model"), eq(jobs.targetId, modelId)))
      .orderBy(desc(jobs.createdAt)).limit(1).for("update");
    const [model] = await tx.select().from(models).where(eq(models.id, modelId)).for("update");
    if (!job || !model || job.status !== "waiting" || model.status !== "awaiting_approval")
      throw new Error("This model is not waiting for visual target approval");
    if (model.visualTarget !== decision.target)
      throw new Error("The visual target changed. Review the latest image before continuing.");
    const next = { ...job.checkpoint };
    if (decision.action === "approve") next["visual-target-approved"] = decision.target;
    else {
      const revision = Number(next["visual-target-revision"] || 0) + 1;
      next["visual-target-revision"] = String(revision);
      next[`visual-target:${revision}-feedback`] = decision.prompt;
    }
    await tx.update(jobs).set({ status: "queued", checkpoint: next, error: null, finishedAt: null }).where(eq(jobs.id, job.id));
    await tx.update(models).set({ status: "queued", phase: decision.action === "approve" ? "Visual target approved; queued for build" : "Queued for visual target revision", error: null }).where(eq(models.id, modelId));
  });
}
