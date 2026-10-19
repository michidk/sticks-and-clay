import { UnsupportedResolution } from "./resolution";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, assetVersions, projects, runs } from "../db/schema";
import { assertJobActive } from "./queue.server";
import { checkpoint, jobContext } from "./checkpoint.server";
import { settleBatch } from "./batch-state.server";
import { runRole, roleInput } from "../modules/ai/index.server";
import { runPipeline, reviewPipeline } from "../modules/pipelines";
import { reviewPassed, type judgeResult } from "./contracts";
import { reviewEvidence } from "../modules/pipelines/evidence";
import { z } from "zod";
import { viewableReferences } from "./svg";
import { workshopContext } from "./workshop";

export type Review = z.infer<typeof judgeResult>;
/** One produced version of an asset plus what the judge needs to see of it. */
export type Candidate = {
  dimensionErrors?: string[];
  requiredChecksPassed?: boolean;
  key: string;
  /** Named files that together form this version; `key` remains its cover image. */
  parts?: { name: string; key: string }[];
  /** Raster images of the candidate, in the order the judge is told about them. */
  previews: { key: string; label: string }[];
  analysis: unknown;
  /** Engine-ready files derived from this version (pixel sprite sheets and import descriptions), by name. */
  exports?: Record<string, string>;
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
  format: "svg" | "png" | "pixel" | "cad";
  judge: "svg-judge" | "graphic-judge" | "pixel-judge" | "cad-judge";
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
      key: z.string(), parts: z.array(z.object({ name: z.string(), key: z.string() })).optional(),
      exports: z.record(z.string(), z.string()).optional(),
      previews: z.array(z.object({ key: z.string(), label: z.string() })).optional(),
    }).safeParse(source?.result);
    if (saved.success) candidate = {
      ...saved.data,
      previews: saved.data.previews ?? saved.data.parts?.map(({ name, key }) => ({ key, label: name })) ?? [{ key: saved.data.key, label: "previous source version" }],
      analysis: {},
    };
  }
  let previousCandidate: Candidate | undefined;
  let review: Review | undefined;
  let passed = false;

  let unsupportedResolution: string | undefined;
  try {
    if (job.checkpoint["output:unsupported-resolution"])
      throw new UnsupportedResolution(job.checkpoint["output:unsupported-resolution"]);
    await runPipeline(
      definition,
      {
        builder: async (node) => {
          await db
            .update(assetVersions)
            .set({
              status: "building",
              phase: review ? "Revising from review feedback" : kind.format === "cad" ? "Building CAD geometry" : "Generating final graphic",
              iteration: node.iteration,
              progress: progress(node.iteration),
            })
            .where(eq(assetVersions.id, model.id));
          previousCandidate = review ? candidate : undefined;
          candidate = await kind.build(ctx, { node, previous: candidate, feedback: review });
          await assertJobActive();
          await db
            .update(assetVersions)
            .set({
              artifacts: { image: candidate.key, stage: "final", format: kind.format, ...(candidate.parts ? { parts: candidate.parts } : {}), ...(candidate.exports ? { exports: candidate.exports } : {}) },
              visualTarget: candidate.key,
              phase: reviewed ? "Reviewing rendered preview" : kind.format === "cad" ? "CAD ready" : "Graphic ready",
              progress: progress(node.iteration, 0.6),
              status: reviewed ? "judging" : "building",
            })
            .where(eq(assetVersions.id, model.id));
        },
        judge: async (node) => {
          if (!candidate) throw new Error("Nothing to review");
          // An SVG source (an earlier version being revised) is markup the judge cannot view as an image.
          const styleReferences = viewableReferences(ctx.references).slice(0, 3);
          const size = kind.format === "svg" ? "Square vector canvas (1:1)"
            : batch.workshop?.resolution ? `${batch.workshop.resolution.width}x${batch.workshop.resolution.height}`
            : kind.format === "pixel" ? "Native grid from the design, up to 128×128 pixels" : batch.imageSize;
          const evidence = reviewEvidence({
            buildId: `${ctx.attempt}:${node.iteration}`,
            current: candidate.previews.map(({ key, label }) => ({ path: key, label })),
            previous: previousCandidate?.previews.filter((p) => !p.key.endsWith(".svg"))
              .map(({ key, label }) => ({ path: key, label })),
            references: styleReferences.map((path) => ({ path, label: "style reference" })),
            parameters: { size },
            technical: candidate.analysis,
            findings: review,
          });
          const { result, runId } = await runRole({
            role: kind.judge,
            stepId: node.id,
            iteration: node.iteration,
            projectId: model.projectId,
            batchId: batch.id,
            modelId: model.id,
            images: evidence.images,
            input: await roleInput(kind.judge, {
              design: batch.design,
              name: model.name,
              request: ctx.request + workshopContext(batch.workshop, false),
              size,
              images: evidence.labels,
              analysis: JSON.stringify(candidate.analysis, null, 2),
              feedback: review ? JSON.stringify(review, null, 2) : "None",
            }),
          });
          await assertJobActive();
          review = result;
          if (candidate.requiredChecksPassed === false) {
            result.passed = false;
            result.improvements.push({ priority: "major", issue: "Required geometric checks failed or remain unknown", action: "Inspect the measured checks against the frozen CAD contract and correct the source", view: "metrics" });
          }
          if (candidate.dimensionErrors?.length) {
            result.passed = false;
            result.improvements.push(...candidate.dimensionErrors.map((issue) => ({
              priority: "major" as const, issue, action: "Keep the requested dimensions; do not resize or substitute a different canvas", view: "dimensions",
            })));
            await db.update(runs).set({ result }).where(eq(runs.id, runId));
          }
          result.passed = reviewPassed(result);
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

  } catch (error) {
    if (!(error instanceof UnsupportedResolution)) throw error;
    unsupportedResolution = error.message;
    await checkpoint("output:unsupported-resolution", error.message);
  }

  if (!candidate && !unsupportedResolution) throw new Error("No graphic was produced");
  await assertJobActive();
  const dimensionErrors = unsupportedResolution ? [unsupportedResolution] : candidate?.dimensionErrors ?? [];
  if (dimensionErrors.length) review = {
    passed: false, score: review?.score ?? 0, summary: dimensionErrors.join("\n"),
    improvements: dimensionErrors.map((issue) => ({ priority: "major", issue, action: "Review the output dimensions. Change the resolution only if you intend to override it.", view: "dimensions" })),
  };
  const verdict = dimensionErrors.length ? "limit_reached" : !reviewed ? "unreviewed" : passed ? "approved" : "limit_reached";
  await db.transaction(async (tx) => {
    await tx
      .update(assetVersions)
      .set({
        status: "done",
        progress: 100,
        ...(dimensionErrors.length ? { feedback: review } : {}),
        phase:
          dimensionErrors.length ? "Complete · output dimension error" : verdict === "approved"
            ? "Approved"
            : verdict === "unreviewed"
              ? `${kind.format === "cad" ? "CAD" : "Graphic"} ready · no review requested`
              : "Complete · review limit reached",
        verdict,
        ...(candidate ? {
          visualTarget: candidate.key,
          artifacts: { image: candidate.key, stage: "final", format: kind.format, ...(candidate.parts ? { parts: candidate.parts } : {}), ...(candidate.exports ? { exports: candidate.exports } : {}) },
        } : {}),
      })
      .where(eq(assetVersions.id, model.id));
    await tx
      .update(jobs)
      .set({ checkpoint: { ...job.checkpoint, applied: "yes" } })
      .where(eq(jobs.id, job.id));
  });
  await settleBatch(batch.id);
}
