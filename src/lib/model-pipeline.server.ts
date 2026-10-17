import { assetKinds } from "./asset-kinds.server";
import { runReviewedAsset } from "./reviewed-asset.server";
import { prepareVisualTarget } from "./visual-target.server";
import { referencedChange } from "./object-reference";
import { analyzeModel } from "../modules/model-analysis/index.server";
import { and, eq } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { db } from "../db/client";
import { projects, batches, assetVersions, runs } from "../db/schema";
import { assertJobActive } from "./queue.server";
import { REVIEW_VIEWS, judgeImageLabels } from "./photo-views";
import { GlbHandoverError } from "../modules/glb/handover";
import { archiveVersion, archivePhotography } from "./versions.server";
import { runRole, roleInput } from "../modules/ai/index.server";
import {
  runPipeline,
  modelReviewPipeline,
  qualityPipeline,
  photographyPipeline,
  refinementPipeline,
} from "../modules/pipelines";
import { prompt } from "./prompts.server";
import { DATA } from "./storage.server";
import { mockupReferences, workshopContext } from "./workshop";
import { compareStyle } from "./asset-style";
import { checkpoint, jobContext } from "./checkpoint.server";
import { settleBatch } from "./batch-state.server";
import { reviewEvidence } from "../modules/pipelines/evidence";
async function one<T>(rows: T[]) {
  if (!rows[0]) throw new Error("Record not found");
  return rows[0];
}
export async function executeAssetVersionJob(targetId: string) {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");

  const model = await one(
    await db.select().from(assetVersions).where(eq(assetVersions.id, targetId)),
  );
  const batch = await one(
    await db.select().from(batches).where(eq(batches.id, model.batchId)),
  );
  const project = await one(
    await db.select().from(projects).where(eq(projects.id, model.projectId)),
  );
  const request = model.objectReference && model.sourceRunId
    ? referencedChange(model.prompt, model.sourceRunId, model.objectReference)
    : model.prompt;
  const attempt = job.checkpoint.workspace || job.id;
  if (project.assetType !== "model") {
    await runReviewedAsset(assetKinds[project.assetType], {
      model, batch, project, request, attempt,
      references: [
        ...(job.checkpoint["branch-references"] ? JSON.parse(job.checkpoint["branch-references"]) : (batch.workshop?.references ?? project.references)),
        ...(batch.workshop?.examples?.flatMap((e) => e.renders.slice(0, 1)) || []),
        ...(batch.workshop?.references ? [] : mockupReferences(batch.workshop)),
      ],
    });
    return;
  }
  const [sourceRun] = model.sourceRunId
    ? await db
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.id, model.sourceRunId),
            eq(runs.modelId, model.parentModelId!),
          ),
        )
    : [];
  const sourceArtifacts = (sourceRun?.result as any)?.artifacts;
  if (model.sourceRunId && !sourceArtifacts?.blend)
    throw new Error("The selected source version is unavailable");
  let feedback: unknown = model.feedback,
    previous = sourceArtifacts?.blend
      ? resolve(DATA, String(sourceArtifacts.blend))
      : model.artifacts?.blend
        ? resolve(DATA, String(model.artifacts.blend))
        : job.checkpoint["import-baseline"]
          ? resolve(DATA, job.checkpoint["import-baseline"])
          : "",
    previousScript = sourceArtifacts?.script || model.artifacts?.script,
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
  const rounds = definition.nodes.filter(
    (node) => node.task === "builder",
  ).length;
  const modelProgress = (iteration: number, fraction = 0) =>
    Math.round(
      (legacy ? 0 : 5) +
        ((iteration + fraction) / rounds) * (legacy ? 100 : 95),
    );
  let metrics: any;
  let images: string[] = sourceArtifacts?.renders || [];
  const photography = definition.version >= 3;
  let currentBuilderRunId = "";
  let buildSummary = "";
  const pipelineVersion = `${definition.id}:${definition.version}`;
  if (job.checkpoint.pipeline && job.checkpoint.pipeline !== pipelineVersion)
    throw new Error("Unsupported saved pipeline version");
  if (!job.checkpoint.pipeline) await checkpoint("pipeline", pipelineVersion);
  const { target, visualReferences } = await prepareVisualTarget({ model, batch, project, request, attempt, legacy });
  let geometryBlocked = false;
  await runPipeline(
    definition,
    {
      builder: async ({ iteration, stage, workPass }) => {
        const directory = `models/${model.id}/${attempt}/iteration-${iteration}`;
        await mkdir(resolve(DATA, directory), { recursive: true });
        const capabilityKey = `capability:${iteration}`;
        const capability = job.checkpoint[capabilityKey] || crypto.randomUUID();
        if (!job.checkpoint[capabilityKey])
          await checkpoint(capabilityKey, capability);
        await mkdir(resolve(DATA, "capabilities"), { recursive: true });
        await writeFile(
          resolve(DATA, "capabilities", capability + ".json"),
          JSON.stringify({
            directory,
            role: "builder",
            sourceScript: previousScript,
            spriteTarget: batch.spriteTarget,
            textureReferences:
              batch.workshop?.examples?.flatMap((e) => e.textures) || [],
            inputs: [
              ...(previous
                ? [
                    previous
                      .slice(resolve(DATA).length + 1)
                      .replaceAll("\\", "/"),
                  ]
                : []),
              ...(batch.workshop?.examples?.flatMap((e) =>
                [e.script, e.blend, ...e.textures].filter(Boolean),
              ) || []),
            ],
          }),
        );
        await db
          .update(assetVersions)
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
          .where(eq(assetVersions.id, model.id));
        let buildProgress = modelProgress(iteration);
        const exampleContext = await Promise.all(
          (batch.workshop?.examples || []).map(async (e) => ({
            name: e.name,
            textureReferences: e.textures,
            blend: e.blend
              ? resolve(DATA, e.blend).replaceAll("\\", "/")
              : undefined,
            script: e.script
              ? (await readFile(resolve(DATA, e.script), "utf8")).slice(
                  0,
                  12000,
                )
              : undefined,
          })),
        );
        await writeFile(
          resolve(DATA, directory, "build-request.json"),
          JSON.stringify(
            {
              design: batch.design,
              designVersion: batch.designVersion,
              request,
              workshop: batch.workshop,
              stage,
              workPass,
            },
            null,
            2,
          ),
        );
        const { runId: builderRunId } = await runRole({
          role: "builder",
          construction: {
            request,
            stage: stage || "complete",
            outputTarget: batch.spriteTarget ? "sprite" : "model",
          },
          onActivity: async (tool) => {
            const phase = tool.includes("view_render")
              ? "Inspecting rendered asset"
              : tool.includes("execute_blender_code") ||
                  tool.includes("asset_workspace")
                ? "Building geometry, exporting and rendering"
                : tool.includes("get_scene_info")
                  ? "Inspecting Blender workspace"
                  : null;
            if (!phase) return;
            const fraction = tool.includes("view_render")
              ? 0.45
              : tool.includes("execute_blender_code") ||
                  tool.includes("asset_workspace")
                ? 0.15
                : 0.05;
            await db
              .update(assetVersions)
              .set({
                phase,
                progress: (buildProgress = Math.max(
                  buildProgress,
                  modelProgress(iteration, fraction),
                )),
              })
              .where(eq(assetVersions.id, model.id));
          },
          projectId: model.projectId,
          batchId: batch.id,
          modelId: model.id,
          iteration,
          images: [
            ...(target ? [target] : []),
            ...visualReferences,
            ...(batch.workshop?.examples?.flatMap((e) =>
              e.renders.slice(0, 1),
            ) || []),
            ...(workPass ? images : []),
          ],
          input:
            (await roleInput("builder", {
              version: batch.designVersion,
              design: batch.design,
              name: model.name,
              request,
              capability,
              directory: resolve(DATA, directory),
              previous: previous || "None",
              feedback: JSON.stringify(feedback || null, null, 2),
              stage: stage || "complete",
              target: target
                ? resolve(DATA, target)
                : "No visual target; follow the approved design and request",
            })) +
            (model.sourceRunId && iteration === 0
              ? `\n\nThis is a ${model.branchKind === "fork" ? "fork" : "prompt iteration"} of a saved model. Load the supplied previous Blender source and revise its actual geometry/materials for the requested change; preserve useful existing work. The first additional photographs show the selected source version.`
              : "") +
            (workPass
              ? "\n\n" +
                (await prompt("models/modeling-pass", {
                  pass: workPass,
                  photographs: images.length,
                }))
              : "") +
            workshopContext(batch.workshop) +
            `\n\nAPPROVED EXAMPLE SOURCE DATA\n${JSON.stringify(exampleContext)}`,
        });
        currentBuilderRunId = builderRunId;
        try {
          const state = await readFile(
            resolve(DATA, directory, "build-state.json"),
            "utf8",
          )
            .then(JSON.parse)
            .catch((error) => {
              if (error.code !== "ENOENT") throw error;
              return null;
            });
          if (state && (!state.ok || state.preview))
            throw new Error(
              "The most recent build did not finish a successful final export",
            );
          if (state?.scriptSha256) {
            const source = (
              await readFile(resolve(DATA, directory, "asset.py"), "utf8")
            )
              .replaceAll("\r\n", "\n")
              .replaceAll("\r", "\n");
            if (
              createHash("sha256").update(source).digest("hex") !==
              state.scriptSha256
            )
              throw new Error(
                "The saved script changed after its final render; run it again before handoff",
              );
          }
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
          .update(assetVersions)
          .set({ phase: "Preparing GLB for handover" })
          .where(eq(assetVersions.id, model.id));
        try {
          artifacts = {
            ...(await archiveVersion(builderRunId, directory, !photography)),
            visualTarget: target,
            stage: stage || "complete",
            ...(workPass ? { workPass } : {}),
          };
          if (
            batch.spriteTarget &&
            !(artifacts.sprites as { image?: string })?.image
          )
            throw new Error(
              "Sprite-target build did not publish its required sprite evidence",
            );
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
        buildSummary = String(
          (builtRun.result as any)?.summary || "Not recorded",
        );
        await db
          .update(runs)
          .set({ result: { ...(builtRun.result as object), artifacts } })
          .where(eq(runs.id, builderRunId));
        metrics = artifacts.metrics;
        if (batch.workshop && metrics?.style)
          metrics.styleReview = compareStyle(
            metrics.style,
            batch.workshop.examples?.map((e) => e.metrics) || [],
            batch.workshop.variation,
          );
        images = artifacts.renders as string[];
        previous = resolve(DATA, String(artifacts.blend));
        previousScript = artifacts.script;
        if (photography) return;
        await db
          .update(assetVersions)
          .set({
            artifacts,
            phase: batch.judgeIterations
              ? "Reviewing rendered views"
              : "Export verified",
            progress: modelProgress(iteration, 0.6),
            status: batch.judgeIterations ? "judging" : "building",
          })
          .where(eq(assetVersions.id, model.id));
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
        const requiredViews: string[] = JSON.parse(job.checkpoint[coverageKey]);
        const directory = `models/${model.id}/${attempt}/photography-${iteration}`;
        const capabilityKey = `capability:photographer:${iteration}`;
        const capability = job.checkpoint[capabilityKey] || crypto.randomUUID();
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
          .update(assetVersions)
          .set({
            status: "building",
            phase: "Photographing exported model",
            progress: modelProgress(iteration, 0.55),
          })
          .where(eq(assetVersions.id, model.id));
        const { runId } = await runRole({
          role: "photographer",
          projectId: model.projectId,
          batchId: batch.id,
          modelId: model.id,
          iteration,
          images: [...(target ? [target] : []), ...visualReferences],
          input: await roleInput("photographer", {
            name: model.name,
            request,
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
          .update(assetVersions)
          .set({
            artifacts,
            phase: batch.judgeIterations
              ? "Reviewing photographed views"
              : "Photography complete",
            progress: modelProgress(iteration, 0.75),
            status: batch.judgeIterations ? "judging" : "building",
          })
          .where(eq(assetVersions.id, model.id));
      },
      judge: async ({ iteration, stage, stopOnFail, workPass }) => {
        const analysis = await analyzeModel(
          resolve(DATA, String(artifacts.glb)),
        );
        await assertJobActive();
        const sprite =
          batch.spriteTarget &&
          (artifacts.sprites as { image?: string })?.image;
        const evidence = reviewEvidence({
          buildId: currentBuilderRunId,
          current: [
            ...images.map((path) => ({
              path,
              label: path.split("/").pop() || "model view",
            })),
            ...(sprite
              ? [
                  {
                    path: sprite,
                    label: "sprite sheet: rows=frames, columns=directions",
                  },
                ]
              : []),
          ],
          references: [
            ...(target ? [{ path: target, label: "visual target" }] : []),
            ...visualReferences.map((path: string) => ({
              path,
              label: "style reference",
            })),
          ],
          parameters: batch.spriteTarget || {},
          technical: analysis,
          findings: feedback,
        });
        const { result } = await runRole({
          role: "judge",
          construction: {
            request,
            stage: stage || "complete",
            outputTarget: batch.spriteTarget ? "sprite" : "model",
          },
          projectId: model.projectId,
          batchId: batch.id,
          modelId: model.id,
          iteration,
          images: evidence.images,
          input:
            (await roleInput("judge", {
              design: batch.design,
              stage: stage || "complete",
              target:
                evidence.labels +
                "\n" +
                judgeImageLabels(
                  [
                    ...images,
                    ...(batch.spriteTarget &&
                    (artifacts.sprites as { image?: string })?.image
                      ? [(artifacts.sprites as { image: string }).image]
                      : []),
                  ],
                  Boolean(target),
                ) +
                (batch.spriteTarget
                  ? `\nSprite sheet at image ${images.length + 1}; rows=frames, columns=directions. Settings: ${JSON.stringify(batch.spriteTarget)}. Any concept/reference images follow the sprite sheet.`
                  : ""),
              analysis: JSON.stringify(analysis),
              request,
              metrics: JSON.stringify(metrics),
              feedback: JSON.stringify(feedback),
            })) +
            (workPass
              ? "\n\n" +
                (await prompt("models/modeling-review", {
                  pass: workPass,
                  summary: buildSummary,
                }))
              : "") +
            workshopContext(batch.workshop, false),
        });
        await assertJobActive();
        feedback = result;
        passed = result.passed;
        geometryBlocked =
          stage === "geometry" && Boolean(stopOnFail) && !passed;
        await db
          .update(assetVersions)
          .set({
            feedback: result,
            verdict: passed
              ? stage === "geometry"
                ? "geometry_approved"
                : "approved"
              : "changes_requested",
          })
          .where(eq(assetVersions.id, model.id));
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
    .update(assetVersions)
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
    .where(eq(assetVersions.id, model.id));
  await settleBatch(batch.id);
  await checkpoint("applied", "yes");
}
