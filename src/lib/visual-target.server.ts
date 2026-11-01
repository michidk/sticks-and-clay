import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { batches, jobs, assetVersions, projects } from "../db/schema";
import { runImageRole } from "../modules/ai/index.server";
import { visualTargetDecisionInput } from "./api-inputs";
import { checkpoint, jobContext, readCheckpoint } from "./checkpoint.server";
import { renderSvgReference } from "./svg-render.server";
import { prompt } from "./prompts.server";
import { mockupReferences, svgIntentOf, workshopContext } from "./workshop";
import { hasVisualTarget, visualTargetGuides } from "./visual-target";
import { generationPalettes } from "./pixel-design-palette";
import { palettePromptText } from "./pixel-palettes";
import { assertJobActive, JobCancelled, JobWaiting } from "./queue.server";

const targetInput = z.object({
  prompt: z.string(),
  images: z.array(z.string()),
  references: z.array(z.string()).optional(),
});

export async function prepareVisualTarget({ model, batch, project, request, attempt, legacy }: {
  model: typeof assetVersions.$inferSelect;
  batch: typeof batches.$inferSelect;
  project: typeof projects.$inferSelect;
  request: string;
  attempt: string;
  legacy: boolean;
}) {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  const originalInput = readCheckpoint("visual-target-input", targetInput);
  const references: string[] = originalInput?.references ?? originalInput?.images ?? [
        ...(job.checkpoint["branch-references"] ? JSON.parse(job.checkpoint["branch-references"]) : (batch.workshop?.references ?? project.references)),
        ...(batch.workshop?.references ? [] : mockupReferences(batch.workshop)),
      ];
  if (!hasVisualTarget(project.assetType) || (project.assetType !== "model" && batch.visualTargetVersion === 0))
    return { target: null, visualReferences: references };
  if (legacy)
    return { target: model.visualTarget, visualReferences: references };
  if (batch.visualTargetMode === "skip")
    return { target: null, visualReferences: references };
  const revision = Number(job.checkpoint["visual-target-revision"] || 0);
  const key = revision ? `visual-target:${revision}` : "visual-target";
  const inputKey = `${key}-input`;
  let target = job.checkpoint[key];
  if (!target) {
    await db.update(assetVersions).set({ status: "building", phase: revision ? "Revising visual target" : "Creating visual target", progress: 2 }).where(eq(assetVersions.id, model.id));
    if (!job.checkpoint[inputKey]) {
      const base = (await prompt("generation/visual-target", {
        design: batch.design, name: model.name, request,
        assetType: project.assetType, guidance: (await prompt(visualTargetGuides[project.assetType], {})) + (project.assetType === "svg" ? `\nSVG intent: ${svgIntentOf(batch.workshop)}.` : ""),
      })) + workshopContext(batch.workshop, false, project.assetType === "cad" ? "cad" : project.assetType === "svg" ? "svg" : undefined)
        + (project.assetType === "pixel" ? `\n\nAPPROVED PIXEL PALETTE\n${palettePromptText(generationPalettes(batch.design, request))}` : "");
      const sources = [...references, ...(batch.workshop?.startingPoint?.views ?? (batch.workshop?.startingPoint?.preview ? [batch.workshop.startingPoint.preview] : []))];
      const images = await Promise.all([...new Set(sources)].map((key) => key.endsWith(".svg") ? renderSvgReference(key) : key));
      await checkpoint(inputKey, JSON.stringify({
        references,
        prompt: revision ? `${base}\n\nRevise the previous visual target according to this feedback:\n${job.checkpoint[`${key}-feedback`]}` : base,
        images: revision && model.visualTarget ? [...images, model.visualTarget] : images,
      }));
    }
    const input = targetInput.parse(JSON.parse(job.checkpoint[inputKey]));
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
      await tx.update(assetVersions).set({ visualTarget: target, status: "awaiting_approval", phase: "Review visual target", progress: 5, error: null }).where(eq(assetVersions.id, model.id));
    });
    throw new JobWaiting("Visual target awaits approval");
  }
  await db.update(assetVersions).set({ visualTarget: target }).where(eq(assetVersions.id, model.id));
  return { target, visualReferences: references };
}

export async function decideVisualTarget(modelId: string, decision: z.infer<typeof visualTargetDecisionInput>) {
  await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.kind, "model"), eq(jobs.targetId, modelId)))
      .orderBy(desc(jobs.createdAt)).limit(1).for("update");
    const [model] = await tx.select().from(assetVersions).where(eq(assetVersions.id, modelId)).for("update");
    if (!job || !model || job.status !== "waiting" || model.status !== "awaiting_approval")
      throw new Error("This asset is not waiting for visual target approval");
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
    await tx.update(assetVersions).set({ status: "queued", phase: decision.action === "approve" ? "Visual target approved; queued for build" : "Queued for visual target revision", error: null }).where(eq(assetVersions.id, modelId));
  });
}
