import { cp, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  checkpointMany,
  jobContext,
  readCheckpoint,
} from "../../lib/checkpoint.server";
import { DATA, publishFiles } from "../../lib/storage.server";
import { assertJobActive } from "../../lib/queue.server";
import { runRole, roleInput } from "../ai/index.server";
import { runPipeline } from "../pipelines";
import { assetReviewPipeline } from "../pipelines/review";
import { reviewEvidence } from "../pipelines/evidence";
import {
  materialBuildResult,
  materialReviewResult,
  type MaterialParameters,
} from "../../lib/materials";
import { runExportProcess, readReceipt } from "../asset-builds/index.server";

export const materialSupport = [
  "materialkit.py",
  "materialcore.py",
  "materialcache.py",
  "materialcalibration.py",
  "calibration-targets.json",
  "materialrecipes.py",
  "materialoutput.py",
  "render.py",
  "requirements.txt",
];

export async function reviewMaterial(
  projectId: string,
  root: string,
  parameters: MaterialParameters,
  python: string,
) {
  const job = jobContext.getStore()!;
  let script = await readFile(resolve(root, "asset.py"), "utf8");
  let feedback = "No previous review",
    previousImage = job.checkpoint.previousImage || "";
  let selected = "",
    outcome = "unreviewed";
  const reviews: unknown[] = [];
  const rounds = Number(job.checkpoint.reviewRounds || 0);
  const buildInput = (evidence: string) =>
    roleInput("material-builder", {
      description: job.checkpoint.description,
      design: job.checkpoint.design,
      guidance: job.checkpoint.guidance,
      parameters: JSON.stringify(parameters),
      capabilities:
        "materialkit 2: build_material(params), check(params), noise(size, seed, scale), linear(rgb), fracture_mask(size, seed, cells, width=.05), layer(base, coating, mask, tile_metres), derive_surface(height_mm, tile_metres). Recipes: sand, gravel, stone, wood, brick, painted_metal. Parameters include moisture, dirt, burial, sizeSpread (0..1). Result arrays: albedo linear RGB, roughness/metallic/height/ao [0,1], normal encoded RGB, heightWindowMm, particles, warnings. Import numpy as np for periodic layer masks; changing height requires recomputing normal/AO coherently. Do not invent helper functions.",
      script,
      feedback,
      evidence,
    });
  const referenceImages: string[] = JSON.parse(
    job.checkpoint.referenceImages || "[]",
  );
  await runPipeline(
    assetReviewPipeline(rounds),
    {
      build: async ({ iteration, id }) => {
        const key = `material:v1:${id}`;
        const result = job.checkpoint[key]
          ? materialBuildResult.parse(JSON.parse(job.checkpoint[key]))
          : (
              await runRole({
                role: "material-builder",
                projectId,
                stepId: key,
                input: await buildInput(
                  previousImage
                    ? "Image 1 is the previous material result. Any remaining images are saved same-kind style examples."
                    : "No current rendered evidence yet. Any attached images are saved same-kind style examples.",
                ),
                images: [
                  ...(previousImage ? [previousImage] : []),
                  ...referenceImages,
                ],
              })
            ).result;
        script = result.script;
        const directory = resolve(root, "iterations", String(iteration));
        await mkdir(directory, { recursive: true });
        for (const name of materialSupport)
          await copyFile(resolve(root, name), resolve(directory, name));
        // Older pinned renderers predate the publication helper; do not upgrade them on resume.
        await copyFile(
          resolve(root, "build_artifacts.py"),
          resolve(directory, "build_artifacts.py"),
        ).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        await writeFile(
          resolve(directory, "params.json"),
          JSON.stringify(parameters, null, 2),
        );
        if (!job.checkpoint[`material:v1:render:${iteration}`])
          await writeFile(resolve(directory, "asset.py"), script);
        await checkpointMany({
          [key]: JSON.stringify(result),
          notes: result.notes,
        });
      },
      render: async ({ iteration, id }) => {
        const key = `material:v1:${id}`,
          directory = resolve(root, "iterations", String(iteration));
        if (!job.checkpoint[key]) {
          for (let repair = 0; ; repair++) {
            try {
              // Cheap script validation precedes the independently judged delivery render.
              await runExportProcess(
                python,
                [resolve(directory, "render.py"), "--mode", "quick"],
                directory,
                180000,
              );
              await runExportProcess(
                python,
                [resolve(directory, "render.py"), "--mode", "final"],
                directory,
                180000,
              );
              await readReceipt(resolve(directory, "output"));
              break;
            } catch (error) {
              await assertJobActive();
              const failure = await readFile(
                resolve(directory, "failure.json"),
                "utf8",
              )
                .then(JSON.parse)
                .catch(() => null);
              if (
                repair >= 2 ||
                !failure ||
                !["script", "validation"].includes(failure.kind)
              )
                throw error;
              feedback = `Runtime repair required: ${failure.message}`;
              const result = (
                await runRole({
                  role: "material-builder",
                  projectId,
                  stepId: `${key}:repair:${repair}`,
                  input: await buildInput(
                    "No current result: the script failed.",
                  ),
                  images: previousImage ? [previousImage] : [],
                })
              ).result;
              script = result.script;
              await writeFile(resolve(directory, "asset.py"), script);
              await writeFile(
                resolve(directory, `repair-${repair}.json`),
                JSON.stringify(result, null, 2),
              );
            }
          }
          await checkpointMany({ [key]: directory });
        }
        script = await readFile(resolve(directory, "asset.py"), "utf8");
        selected = directory;
      },
      review: async ({ iteration, id }) => {
        const key = `material:v1:${id}`;
        const image = `materials/${job.id}/iterations/${iteration}/output/review.png`;
        const currentImages = [
          image,
          ...["albedo.png", "normal.png", "lighting.png"].map(
            (name) =>
              `materials/${job.id}/iterations/${iteration}/output/${name}`,
          ),
        ];
        await publishFiles(currentImages);
        const receipt = await readReceipt(resolve(selected, "output"));
        const report = await readFile(
          resolve(selected, "output/material.json"),
          "utf8",
        );
        const evidence = reviewEvidence({
          buildId: receipt.buildId,
          current: currentImages.map((path, index) => ({
            path,
            label: [
              "review sheet",
              "full-resolution unlit albedo",
              "full-resolution OpenGL normal",
              "opposing-light sheet",
            ][index],
          })),
          previous: previousImage
            ? [{ path: previousImage, label: "previous review sheet" }]
            : [],
          references: referenceImages.map((path) => ({
            path,
            label: "saved style example",
          })),
          script,
          parameters,
          technical: receipt,
          findings: feedback,
        });
        const result = job.checkpoint[key]
          ? readCheckpoint(key, materialReviewResult)!
          : (
              await runRole({
                role: "material-judge",
                projectId,
                stepId: key,
                images: evidence.images,
                input: await roleInput("material-judge", {
                  description: job.checkpoint.description,
                  design: job.checkpoint.design,
                  parameters: JSON.stringify(parameters),
                  report: JSON.stringify(receipt) + "\n" + report,
                  requirements:
                    job.checkpoint[`material:v1:build:${iteration}`],
                  feedback,
                  evidence: `${evidence.labels}\nFinal ${parameters.size}px maps.`,
                }),
              })
            ).result;
        const passed =
          result.passed && !result.findings.some((f) => f.severity !== "minor");
        const review = {
          ...result,
          passed,
          iteration,
          image,
          buildId: receipt.buildId,
        };
        reviews.push(review);
        feedback = JSON.stringify(review);
        previousImage = image;
        outcome = passed ? "approved" : "issues";
        await checkpointMany({
          [key]: JSON.stringify(review),
          review: JSON.stringify(review),
          reviews: JSON.stringify(reviews),
          outcome,
        });
        return { passed };
      },
    },
    assertJobActive,
  );
  await copyFile(resolve(selected, "asset.py"), resolve(root, "asset.py"));
  await cp(resolve(selected, "output"), resolve(root, "output"), {
    recursive: true,
  });
  await checkpointMany({ outcome, reviewed: "yes" });
}
