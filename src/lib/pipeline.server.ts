import { executeModelJob } from "./model-pipeline.server";
import { renderAssignment } from "../modules/materials/assignment.server";
import { settleBatch } from "./batch-state.server";
import { analyzeModel } from "../modules/model-analysis/index.server";
import { and, eq } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { db } from "../db/client";
import { projects, revisions, batches, models, jobs, runs } from "../db/schema";
import { assertJobActive } from "./queue.server";
import { REVIEW_VIEWS, judgeImageLabels } from "./photo-views";
import { GlbHandoverError } from "../modules/glb/handover";
import { archiveVersion, archivePhotography } from "./versions.server";
import { runRole, roleInput, runImageRole } from "../modules/ai/index.server";
import {
  runPipeline,
  modelReviewPipeline,
  qualityPipeline,
  photographyPipeline,
  refinementPipeline,
} from "../modules/pipelines";
import { photographProject } from "./project-photography.server";
import { renderCollection } from "./collection.server";
import { prompt } from "./prompts.server";
import { DATA } from "./storage.server";
import { workshopContext } from "./workshop";
import { compareStyle } from "./asset-style";
import { renderPresentation } from "./workshop-actions.server";
import { renderMaterial } from "./materials.server";
import { checkpoint, jobContext } from "./checkpoint.server";
async function one<T>(rows: T[]) {
  if (!rows[0]) throw new Error("Record not found");
  return rows[0];
}
export async function executeJob(kind: string, targetId: string) {
  await assertJobActive();
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  if (job.checkpoint.applied === "yes") return;
  if (kind === "material-assignment") {
    await renderAssignment();
    return;
  }
  if (kind === "material") {
    await renderMaterial(targetId);
    return;
  }
  if (kind === "presentation") {
    await renderPresentation();
    return;
  }
  if (kind === "project-photo") {
    await photographProject(targetId);
    await checkpoint("applied", "yes");
    return;
  }
  if (kind === "demo") {
    await renderCollection(targetId);
    await checkpoint("applied", "yes");
    return;
  }
  if (kind === "design") {
    const p = await one(
      await db.select().from(projects).where(eq(projects.id, targetId)),
    );
    await db
      .update(projects)
      .set({
        status: "designing",
        phase: "Reading references and writing design",
        progress: 20,
      })
      .where(eq(projects.id, p.id));
    const designRole =
      p.assetType === "graphic" ? "graphic-designer" : "designer";
    const input = await roleInput(designRole, {
      name: p.name,
      description: p.description,
    });
    const { result } = await runRole({
      role: designRole,
      projectId: p.id,
      input,
      images: p.references,
    });
    await assertJobActive();
    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({
          design: result.design,
          designVersion: p.designVersion + 1,
          status: "review",
          phase: "Review and approve design",
          progress: 100,
        })
        .where(eq(projects.id, p.id));
      await tx
        .update(jobs)
        .set({ checkpoint: { ...job.checkpoint, applied: "yes" } })
        .where(eq(jobs.id, job.id));
      await tx.insert(revisions).values({
        id: crypto.randomUUID(),
        projectId: p.id,
        version: p.designVersion + 1,
        content: result.design,
        author: "designer",
      });
    });
  } else if (kind === "design-from-model") {
    const snapshot = job.checkpoint;
    const [p] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, targetId));
    const [model] = await db
      .select()
      .from(models)
      .where(eq(models.id, snapshot.modelId));
    if (!p || !model || model.projectId !== p.id)
      throw new Error("Model or project is missing");
    if (p.designVersion !== Number(snapshot.designVersion))
      throw new Error("Design changed since this update was requested");
    const references: string[] = JSON.parse(snapshot.references);
    const { result } = await runRole({
      role: "design-from-model",
      projectId: p.id,
      modelId: model.id,
      input: await roleInput("design-from-model", {
        name: p.name,
        version: snapshot.designVersion,
        design: snapshot.design,
        model: model.name,
        request: snapshot.modelPrompt,
        summary: snapshot.sourceSummary,
        metrics: snapshot.sourceMetrics,
        feedback: snapshot.sourceFeedback,
      }),
      images: [...references, snapshot.view],
    });
    await assertJobActive();
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(projects)
        .set({
          design: result.design,
          designVersion: p.designVersion + 1,
          references: [...references, snapshot.view],
          status: "review",
          phase: "Review design",
          progress: 100,
          error: null,
        })
        .where(
          and(
            eq(projects.id, p.id),
            eq(projects.designVersion, p.designVersion),
          ),
        )
        .returning();
      if (!updated.length) throw new Error("Design changed during the update");
      await tx.insert(revisions).values({
        id: crypto.randomUUID(),
        projectId: p.id,
        version: p.designVersion + 1,
        content: result.design,
        author: "model",
      });
      await tx
        .update(jobs)
        .set({ checkpoint: { ...snapshot, applied: "yes" } })
        .where(eq(jobs.id, job.id));
    });
  } else if (kind === "plan") {
    const batch = await one(
      await db.select().from(batches).where(eq(batches.id, targetId)),
    );
    await db
      .update(batches)
      .set({ status: "planning" })
      .where(eq(batches.id, batch.id));
    const [referenceProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, batch.projectId));
    if (!job.checkpoint["planner-references"])
      await checkpoint(
        "planner-references",
        JSON.stringify(referenceProject.references),
      );
    const plannerRole =
      referenceProject.assetType === "graphic" ? "graphic-planner" : "planner";
    const { result, runId } = await runRole({
      images: JSON.parse(job.checkpoint["planner-references"]),
      projectId: batch.projectId,
      batchId: batch.id,
      role: plannerRole,
      input:
        (await roleInput(plannerRole, {
          version: batch.designVersion,
          design: batch.design,
          request: batch.prompt,
          count: batch.count,
        })) + workshopContext(batch.workshop, false),
    });
    if (result.models.length !== batch.count) {
      const error = `Result validation: Planner returned ${result.models.length} models; expected ${batch.count}`;
      await db
        .update(runs)
        .set({ status: "failed", error })
        .where(eq(runs.id, runId));
      throw new Error(error);
    }
    await assertJobActive();
    await db.transaction(async (tx) => {
      await tx
        .update(jobs)
        .set({ checkpoint: { ...job.checkpoint, applied: "yes" } })
        .where(eq(jobs.id, job.id));
      for (const model of result.models) {
        const id = crypto.randomUUID();
        await tx.insert(models).values({
          id,
          projectId: batch.projectId,
          batchId: batch.id,
          ...model,
        });
        await tx
          .insert(jobs)
          .values({ id: crypto.randomUUID(), kind: "model", targetId: id });
      }
      await tx
        .update(batches)
        .set({ status: "building" })
        .where(eq(batches.id, batch.id));
    });
  } else if (kind === "model") {
    await executeModelJob(targetId);
  }
}
export async function failJob(kind: string, id: string, error: string) {
  if (kind === "design-from-model") return;
  if (kind === "design")
    await db
      .update(projects)
      .set({ status: "failed", phase: "Setup failed", error })
      .where(eq(projects.id, id));
  if (kind === "plan" || kind === "demo")
    await db
      .update(batches)
      .set({ status: "failed", error })
      .where(eq(batches.id, id));
  if (kind === "model") {
    const [m] = await db
      .update(models)
      .set({ status: "failed", phase: "Generation failed", error })
      .where(eq(models.id, id))
      .returning();
    if (m) await settleBatch(m.batchId);
  }
}
