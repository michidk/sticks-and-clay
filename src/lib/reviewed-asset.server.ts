import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, assetVersions, projects, runs } from "../db/schema";
import { assertJobActive } from "./queue.server";
import { checkpoint, jobContext } from "./checkpoint.server";
import { settleBatch } from "./batch-state.server";
import { runRole, roleInput } from "../modules/ai/index.server";
import { runPipeline, reviewPipeline } from "../modules/pipelines";
import type { judgeResult } from "./contracts";
import { z } from "zod";
import { viewableReferences } from "./svg";
import { workshopContext } from "./workshop";

export type Review = z.infer<typeof judgeResult>;
/** One produced version of an asset plus what the judge needs to see of it. */
export type Candidate = {
  key: string;
  /** Named files that together form this version; `key` remains its cover image. */
  parts?: { name: string; key: string }[];
  /** Raster images of the candidate, in the order the judge is told about them. */
  previews: { key: string; label: string }[];
  analysis: unknown;
};
export type AssetContext = {
  model: typeof assetVersions.$inferSelect;
  batch: typeof batches.$inferSelect;
  project: typeof projects.$inferSelect;
  request: string;
  attempt: string;
  references: string[];
};
export type AssetKind = {
  /** Stored with the asset; "pixel" is a PNG that views must show without smoothing. */
  format: "svg" | "png" | "pixel";
  judge: "svg-judge" | "graphic-judge" | "pixel-judge";
  /** Produce the first version, or revise `previous` using the judge's `feedback`. */
  build(
    ctx: AssetContext,
    step: { node: { id: string; iteration: number }; previous?: Candidate; feedback?: Review },
  ): Promise<Candidate>;
};

/** Every single-artifact asset type shares this loop, so review, revision limits,
 * verdicts and recovery come with the kind instead of being rebuilt per type.
 */
export async function runReviewedAsset(kind: AssetKind, ctx: AssetContext) {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  const { model, batch } = ctx;
  const definition = reviewPipeline(batch.judgeIterations);
  const version = `${definition.id}:${definition.version}`;
  if (job.checkpoint.pipeline && job.checkpoint.pipeline !== version)
    throw new Error("Unsupported saved pipeline version");
  if (!job.checkpoint.pipeline) await checkpoint("pipeline", version);
  const builds = definition.nodes.filter((node) => node.task === "builder").length;
  const progress = (iteration: number, fraction = 0) =>
    Math.round(5 + ((iteration + fraction) / builds) * 95);
  const reviewed = batch.judgeIterations > 0;
  let candidate: Candidate | undefined;
  if (model.sourceRunId && model.parentModelId) {
    const [source] = await db.select({ result: runs.result }).from(runs).where(and(
      eq(runs.id, model.sourceRunId), eq(runs.modelId, model.parentModelId),
    ));
    const saved = z.object({
      key: z.string(), parts: z.array(z.object({ name: z.string(), key: z.string() })),
    }).safeParse(source?.result);
    if (saved.success) candidate = {
      ...saved.data,
      previews: saved.data.parts.map(({ name, key }) => ({ key, label: name })),
      analysis: {},
    };
  }
  let review: Review | undefined;
  let passed = false;

  await runPipeline(
    definition,
    {
      builder: async (node) => {
        await db
          .update(assetVersions)
          .set({
            status: "building",
            phase: review ? "Revising from review feedback" : "Generating final graphic",
            iteration: node.iteration,
            progress: progress(node.iteration),
          })
          .where(eq(assetVersions.id, model.id));
        candidate = await kind.build(ctx, { node, previous: candidate, feedback: review });
        await assertJobActive();
        await db
          .update(assetVersions)
          .set({
            artifacts: { image: candidate.key, stage: "final", format: kind.format, ...(candidate.parts ? { parts: candidate.parts } : {}) },
            visualTarget: candidate.key,
            phase: reviewed ? "Reviewing rendered preview" : "Graphic ready",
            progress: progress(node.iteration, 0.6),
            status: reviewed ? "judging" : "building",
          })
          .where(eq(assetVersions.id, model.id));
      },
      judge: async (node) => {
        if (!candidate) throw new Error("Nothing to review");
        // An SVG source (an earlier version being revised) is markup the judge cannot view as an image.
        const styleReferences = viewableReferences(ctx.references).slice(0, 3);
        const { result } = await runRole({
          role: kind.judge,
          stepId: node.id,
          iteration: node.iteration,
          projectId: model.projectId,
          batchId: batch.id,
          modelId: model.id,
          images: [...candidate.previews.map((p) => p.key), ...styleReferences],
          input: await roleInput(kind.judge, {
            design: batch.design,
            name: model.name,
            request: ctx.request + workshopContext(batch.workshop, false),
            size: batch.imageSize,
            images:
              candidate.previews.map((p, i) => `Image ${i + 1}: ${p.label}`).join("\n") +
              (styleReferences.length ? "\nLater images: style references, not the artwork under review." : ""),
            analysis: JSON.stringify(candidate.analysis, null, 2),
            feedback: review ? JSON.stringify(review, null, 2) : "None",
          }),
        });
        await assertJobActive();
        review = result;
        passed = result.passed;
        await db
          .update(assetVersions)
          .set({ feedback: result, verdict: passed ? "approved" : "changes_requested" })
          .where(eq(assetVersions.id, model.id));
        return { passed };
      },
    },
    assertJobActive,
  );

  if (!candidate) throw new Error("No graphic was produced");
  await assertJobActive();
  const verdict = !reviewed ? "unreviewed" : passed ? "approved" : "limit_reached";
  await db.transaction(async (tx) => {
    await tx
      .update(assetVersions)
      .set({
        status: "done",
        progress: 100,
        phase:
          verdict === "approved"
            ? "Approved"
            : verdict === "unreviewed"
              ? "Graphic ready · no review requested"
              : "Complete · review limit reached",
        verdict,
        visualTarget: candidate!.key,
        artifacts: { image: candidate!.key, stage: "final", format: kind.format, ...(candidate!.parts ? { parts: candidate!.parts } : {}) },
      })
      .where(eq(assetVersions.id, model.id));
    await tx
      .update(jobs)
      .set({ checkpoint: { ...job.checkpoint, applied: "yes" } })
      .where(eq(jobs.id, job.id));
  });
  await settleBatch(batch.id);
}
