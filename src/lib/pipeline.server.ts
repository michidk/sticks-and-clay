import { analyzeModel } from "../modules/model-analysis/index.server";
import { and, eq } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
      referenceProject.assetType === "graphic"
        ? "graphic-planner"
        : "planner";
    const { result, runId } = await runRole({
      images: JSON.parse(job.checkpoint["planner-references"]),
      projectId: batch.projectId,
      batchId: batch.id,
      role: plannerRole,
      input: await roleInput(plannerRole, {
        version: batch.designVersion,
        design: batch.design,
        request: batch.prompt,
        count: batch.count,
      }),
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
    const model = await one(
      await db.select().from(models).where(eq(models.id, targetId)),
    );
    const batch = await one(
      await db.select().from(batches).where(eq(batches.id, model.batchId)),
    );
    const project = await one(
      await db.select().from(projects).where(eq(projects.id, model.projectId)),
    );
    const attempt = job.checkpoint.workspace || job.id;
    if (project.assetType === "graphic") {
      await db
        .update(models)
        .set({
          status: "building",
          phase: "Generating final graphic",
          progress: 10,
        })
        .where(eq(models.id, model.id));
      const graphic = await runImageRole({
        role: "graphic",
        name: "graphic",
        stepId: "graphic",
        projectId: model.projectId,
        batchId: batch.id,
        modelId: model.id,
        directory: `graphics/${model.id}/${attempt}`,
        prompt: await prompt("graphic", {
          design: batch.design,
          name: model.name,
          request: model.prompt,
        }),
        size: batch.imageSize,
        images: project.references,
        assertActive: assertJobActive,
      });
      await assertJobActive();
      await db.transaction(async (tx) => {
        await tx
          .update(models)
          .set({
            status: "done",
            phase: "Graphic ready",
            progress: 100,
            verdict: "unreviewed",
            visualTarget: graphic.key,
            artifacts: {
              image: graphic.key,
              stage: "final",
              format: "png",
            },
          })
          .where(eq(models.id, model.id));
        await tx
          .update(jobs)
          .set({ checkpoint: { ...job.checkpoint, applied: "yes" } })
          .where(eq(jobs.id, job.id));
      });
      await settleBatch(batch.id);
      return;
    }
    let feedback: unknown = model.feedback,
      previous = model.artifacts?.blend
        ? resolve(DATA, String(model.artifacts.blend))
        : "",
      passed = false,
      artifacts: Record<string, unknown> = {};
    const legacy =
      job.checkpoint.pipeline === "model-review:1" ||
      (!job.checkpoint.pipeline && Boolean(job.checkpoint["agent:builder:0"]));
    const definition = legacy
      ? modelReviewPipeline(batch.judgeIterations)
      : job.checkpoint.pipeline === "model-quality:2"
        ? qualityPipeline(batch.judgeIterations)
        : job.checkpoint.pipeline === "model-quality:3"
          ? photographyPipeline(batch.judgeIterations)
          : refinementPipeline(batch.judgeIterations);
    const rounds = definition.nodes.filter((node) => node.task === "builder").length;
    const modelProgress = (iteration: number, fraction = 0) =>
      Math.round((legacy ? 0 : 5) +
        ((iteration + fraction) / rounds) * (legacy ? 100 : 95));
    let metrics: any;
    let images: string[] = [];
    const photography = definition.version >= 3;
    let currentBuilderRunId = "";
    let buildSummary = "";
    const pipelineVersion = `${definition.id}:${definition.version}`;
    if (job.checkpoint.pipeline && job.checkpoint.pipeline !== pipelineVersion)
      throw new Error("Unsupported saved pipeline version");
    if (!job.checkpoint.pipeline) await checkpoint("pipeline", pipelineVersion);
    let target = model.visualTarget;
    if (!legacy) {
      await db
        .update(models)
        .set({
          status: "building",
          phase: "Creating visual target",
          progress: 2,
        })
        .where(eq(models.id, model.id));
      const savedTarget = job.checkpoint["visual-target"];
      if (savedTarget) target = savedTarget;
      else {
        if (!job.checkpoint["visual-target-input"])
          await checkpoint(
            "visual-target-input",
            JSON.stringify({
              prompt: await prompt("visual-target", {
                design: batch.design,
                name: model.name,
                request: model.prompt,
              }),
              images: project.references,
            }),
          );
        const targetInput = JSON.parse(job.checkpoint["visual-target-input"]);
        const concept = await runImageRole({
          role: "visual-target",
          name: "visual-target",
          stepId: "visual-target",
          projectId: model.projectId,
          batchId: batch.id,
          modelId: model.id,
          directory: `models/${model.id}/${attempt}/concept`,
          prompt: targetInput.prompt,
          images: targetInput.images,
          assertActive: assertJobActive,
        });
        target = concept.key;
        await checkpoint("visual-target", concept.key);
      }
      await assertJobActive();
      await db
        .update(models)
        .set({ visualTarget: target })
        .where(eq(models.id, model.id));
    }
    const visualReferences: string[] = job.checkpoint["visual-target-input"]
      ? JSON.parse(job.checkpoint["visual-target-input"]).images
      : project.references;
    let geometryBlocked = false;
    await runPipeline(
      definition,
      {
        builder: async ({ iteration, stage, workPass }) => {
          const directory = `models/${model.id}/${attempt}/iteration-${iteration}`;
          await mkdir(resolve(DATA, directory), { recursive: true });
          const capabilityKey = `capability:${iteration}`;
          const capability =
            job.checkpoint[capabilityKey] || crypto.randomUUID();
          if (!job.checkpoint[capabilityKey])
            await checkpoint(capabilityKey, capability);
          await mkdir(resolve(DATA, "capabilities"), { recursive: true });
          await writeFile(
            resolve(DATA, "capabilities", capability + ".json"),
            JSON.stringify({ directory }),
          );
          await db
            .update(models)
            .set({
              status: "building",
              phase: workPass
                ? `Modeling pass: ${workPass}`
                : stage === "geometry"
                  ? "Shaping and reviewing geometry"
                  : iteration
                    ? "Applying judge feedback"
                    : "Building geometry and materials",
              iteration,
              progress: modelProgress(iteration),
            })
            .where(eq(models.id, model.id));
          let buildProgress = modelProgress(iteration);
          const { runId: builderRunId } = await runRole({
            role: "builder",
            onActivity: async (tool) => {
              const phase = tool.includes("view_render")
                ? "Inspecting rendered asset"
                : tool.includes("execute_blender_code")
                  ? "Building geometry, exporting and rendering"
                  : tool.includes("get_scene_info")
                    ? "Inspecting Blender workspace"
                    : null;
              if (!phase) return;
              const fraction = tool.includes("view_render")
                ? 0.45
                : tool.includes("execute_blender_code")
                  ? 0.15
                  : 0.05;
              await db
                .update(models)
                .set({
                  phase,
                  progress: (buildProgress = Math.max(
                    buildProgress,
                    modelProgress(iteration, fraction),
                  )),
                })
                .where(eq(models.id, model.id));
            },
            projectId: model.projectId,
            batchId: batch.id,
            modelId: model.id,
            iteration,
            images: [...(target ? [target] : []), ...visualReferences,
              ...(workPass ? images : [])],
            input: (await roleInput("builder", {
              version: batch.designVersion,
              design: batch.design,
              name: model.name,
              request: model.prompt,
              capability,
              directory: resolve(DATA, directory),
              previous: previous || "None",
              feedback: JSON.stringify(feedback || null, null, 2),
              stage: stage || "complete",
              target: target
                ? resolve(DATA, target)
                : "No visual target (legacy attempt)",
            })) + (workPass ? "\n\n" + await prompt("modeling-pass", {
              pass: workPass,
              photographs: images.length,
            }) : ""),
          });
          currentBuilderRunId = builderRunId;
          try {
            metrics = JSON.parse(
              await readFile(resolve(DATA, directory, "metrics.json"), "utf8"),
            );
            const glb = await readFile(resolve(DATA, directory, "asset.glb"));
            if (
              glb.toString("ascii", 0, 4) !== "glTF" ||
              glb.readUInt32LE(4) !== 2 ||
              glb.readUInt32LE(8) !== glb.length
            )
              throw new Error("Invalid GLB export");
            const manifest = JSON.parse(
              glb.toString("utf8", 20, 20 + glb.readUInt32LE(12)),
            );
            if (!manifest.meshes?.length)
              throw new Error("GLB contains no meshes");
            images = ["front", "rear", "detail"].map(
              (view) => `${directory}/${view}.png`,
            );
            for (const image of images) await readFile(resolve(DATA, image));
            await readFile(resolve(DATA, directory, "source.blend"));
            artifacts = {
              glb: `${directory}/asset.glb`,
              blend: `${directory}/source.blend`,
              renders: images,
              metrics,
            };
          } catch (error) {
            const runId = job.checkpoint[`agent:builder:${iteration}`];
            if (runId)
              await db
                .update(runs)
                .set({
                  status: "failed",
                  error: "Artifact validation: " + String(error),
                })
                .where(eq(runs.id, runId));
            throw error;
          }
          await assertJobActive();
          await db
            .update(models)
            .set({ phase: "Preparing GLB for handover" })
            .where(eq(models.id, model.id));
          try {
            artifacts = {
              ...(await archiveVersion(builderRunId, directory, !photography)),
              visualTarget: target,
              stage: stage || "complete",
              ...(workPass ? { workPass } : {}),
            };
          } catch (error) {
            if (error instanceof GlbHandoverError)
              await db
                .update(runs)
                .set({
                  status: "failed",
                  error: "Artifact validation: " + String(error),
                })
                .where(eq(runs.id, builderRunId));
            throw error;
          }
          const [builtRun] = await db
            .select()
            .from(runs)
            .where(eq(runs.id, builderRunId));
          buildSummary = String((builtRun.result as any)?.summary || "Not recorded");
          await db
            .update(runs)
            .set({ result: { ...(builtRun.result as object), artifacts } })
            .where(eq(runs.id, builderRunId));
          metrics = artifacts.metrics;
          images = artifacts.renders as string[];
          previous = resolve(DATA, String(artifacts.blend));
          if (photography) return;
          await db
            .update(models)
            .set({
              artifacts,
              phase: batch.judgeIterations
                ? "Reviewing rendered views"
                : "Export verified",
              progress: modelProgress(iteration, 0.6),
              status: batch.judgeIterations ? "judging" : "building",
            })
            .where(eq(models.id, model.id));
        },
        photographer: async ({ iteration, stage }) => {
          const coverageKey = `photo-views:${iteration}`;
          if (!job.checkpoint[coverageKey])
            await checkpoint(
              coverageKey,
              JSON.stringify(
                job.checkpoint[`agent:photographer:${iteration}`]
                  ? ["front", "rear", "detail"]
                  : REVIEW_VIEWS,
              ),
            );
          const requiredViews: string[] = JSON.parse(
            job.checkpoint[coverageKey],
          );
          const directory = `models/${model.id}/${attempt}/photography-${iteration}`;
          const capabilityKey = `capability:photographer:${iteration}`;
          const capability =
            job.checkpoint[capabilityKey] || crypto.randomUUID();
          if (!job.checkpoint[capabilityKey])
            await checkpoint(capabilityKey, capability);
          await mkdir(resolve(DATA, directory), { recursive: true });
          await writeFile(
            resolve(DATA, "capabilities", capability + ".json"),
            JSON.stringify({
              directory,
              role: "photographer",
              views: requiredViews,
              glb: artifacts.glb,
            }),
          );
          await db
            .update(models)
            .set({
              status: "building",
              phase: "Photographing exported model",
              progress: modelProgress(iteration, 0.55),
            })
            .where(eq(models.id, model.id));
          const { runId } = await runRole({
            role: "photographer",
            projectId: model.projectId,
            batchId: batch.id,
            modelId: model.id,
            iteration,
            images: [...(target ? [target] : []), ...visualReferences],
            input: await roleInput("photographer", {
              name: model.name,
              request: model.prompt,
              design: batch.design,
              stage: stage || "complete",
              capability,
              glb: resolve(DATA, String(artifacts.glb)),
              directory: resolve(DATA, directory),
              metrics: JSON.stringify(metrics),
            }),
          });
          await assertJobActive();
          try {
            artifacts = await archivePhotography(
              runId,
              currentBuilderRunId,
              directory,
              artifacts,
              requiredViews,
            );
          } catch (error) {
            await db
              .update(runs)
              .set({
                status: "failed",
                error: "Artifact validation: Photography: " + String(error),
              })
              .where(eq(runs.id, runId));
            throw error;
          }
          images = artifacts.renders as string[];
          await db
            .update(models)
            .set({
              artifacts,
              phase: batch.judgeIterations
                ? "Reviewing photographed views"
                : "Photography complete",
              progress: modelProgress(iteration, 0.75),
              status: batch.judgeIterations ? "judging" : "building",
            })
            .where(eq(models.id, model.id));
        },
        judge: async ({ iteration, stage, stopOnFail, workPass }) => {
          const analysis = await analyzeModel(
            resolve(DATA, String(artifacts.glb)),
          );
          await assertJobActive();
          const { result } = await runRole({
            role: "judge",
            projectId: model.projectId,
            batchId: batch.id,
            modelId: model.id,
            iteration,
            images: [
              ...images,
              ...(target ? [target] : []),
              ...visualReferences,
            ],
            input: (await roleInput("judge", {
              design: batch.design,
              stage: stage || "complete",
              target: judgeImageLabels(images, Boolean(target)),
              analysis: JSON.stringify(analysis),
              request: model.prompt,
              metrics: JSON.stringify(metrics),
              feedback: JSON.stringify(feedback),
            })) + (workPass ? "\n\n" + await prompt("modeling-review", {
              pass: workPass, summary: buildSummary,
            }) : ""),
          });
          await assertJobActive();
          feedback = result;
          passed = result.passed;
          geometryBlocked =
            stage === "geometry" && Boolean(stopOnFail) && !passed;
          await db
            .update(models)
            .set({
              feedback: result,
              verdict: passed
                ? stage === "geometry"
                  ? "geometry_approved"
                  : "approved"
                : "changes_requested",
            })
            .where(eq(models.id, model.id));
          return { passed };
        },
      },
      assertJobActive,
    );
    await assertJobActive();
    const verdict = !batch.judgeIterations
      ? "unreviewed"
      : passed
        ? "approved"
        : "limit_reached";
    await db
      .update(models)
      .set({
        status: "done",
        progress: 100,
        phase:
          verdict === "approved"
            ? "Approved"
            : verdict === "unreviewed"
              ? "Complete · no judge requested"
              : geometryBlocked
                ? "Geometry review limit reached · surface work withheld"
                : "Complete · review limit reached",
        verdict,
        artifacts,
      })
      .where(eq(models.id, model.id));
    await settleBatch(batch.id);
    await checkpoint("applied", "yes");
  }
}
export async function failJob(kind: string, id: string, error: string) {
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
async function settleBatch(id: string) {
  const rows = await db.select().from(models).where(eq(models.batchId, id));
  if (
    !rows.length ||
    !rows.every((m) => ["done", "failed", "cancelled"].includes(m.status))
  )
    return;
  const [batch] = await db.select().from(batches).where(eq(batches.id, id));
  const [project] = batch
    ? await db
        .select()
        .from(projects)
        .where(eq(projects.id, batch.projectId))
    : [];
  const graphics = project?.assetType === "graphic";
  const hasFinalAsset = rows.some(
    (m) =>
      m.status === "done" &&
      m.artifacts &&
      (graphics ? Boolean(m.artifacts.image) : m.artifacts.stage !== "geometry"),
  );
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(batches)
      .set({
        status: graphics
          ? rows.every((m) => m.status === "done")
            ? "done"
            : "completed_with_errors"
          : hasFinalAsset
            ? "rendering"
            : "completed_with_errors",
      })
      .where(and(eq(batches.id, id), eq(batches.status, "building")))
      .returning();
    if (claimed) {
      const available = await tx
        .select()
        .from(models)
        .where(eq(models.projectId, claimed.projectId));
      if (available.some((m) => m.artifacts?.glb))
        await tx.insert(jobs).values({
          id: crypto.randomUUID(),
          kind: "project-photo",
          targetId: claimed.projectId,
        });
    }
    if (claimed && hasFinalAsset && !graphics)
      await tx
        .insert(jobs)
        .values({ id: crypto.randomUUID(), kind: "demo", targetId: id });
  });
}
