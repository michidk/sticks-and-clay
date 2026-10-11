import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../db/client";
import { jobs, projects, materialVersions } from "../db/schema";
import { materialSchema } from "./materials";
import { DATA, publishFiles } from "./storage.server";
import { assertJobActive } from "./queue.server";
import { checkpoint, checkpointMany, jobContext } from "./checkpoint.server";
import {
  savedExport,
  runExportProcess,
  exportBundle,
} from "../modules/asset-builds/index.server";
import { runRole, roleInput } from "../modules/ai/index.server";
import {
  reviewMaterial,
  materialSupport,
} from "../modules/materials/review.server";
import { readReceipt } from "../modules/asset-builds/index.server";

export async function materialAction(request: Request, path: string[]) {
  if (path[0] !== "projects" || path[2] !== "materials") return null;
  const projectId = z.string().uuid().parse(path[1]);
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project)
    return Response.json({ error: "Project not found" }, { status: 404 });
  if (request.method === "GET") {
    const saved = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.targetId, projectId), eq(jobs.kind, "material")))
      .orderBy(desc(jobs.createdAt))
      .limit(40);
    return Response.json(saved.map(savedExport));
  }
  if (request.method !== "POST") return null;
  if (project.status !== "ready" || project.assetType !== "model")
    throw new Error(
      "Approve the collection design before generating materials",
    );
  const input = z
    .object({
      parameters: materialSchema,
      prompt: z.string().trim().max(12000).default(""),
      reviewRounds: z.number().int().min(0).max(5).default(2),
      parentId: z.string().uuid().optional(),
      exampleIds: z.array(z.string().uuid()).max(3).default([]),
    })
    .parse(await request.json());
  const id = crypto.randomUUID();
  const [parent] = input.parentId
    ? await db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, input.parentId),
            eq(jobs.targetId, projectId),
            eq(jobs.kind, "material"),
            eq(jobs.status, "done"),
          ),
        )
    : [];
  if (input.parentId && !parent)
    throw new Error("Choose a completed material from this collection");
  const materialId = parent?.checkpoint.materialId || crypto.randomUUID();
  const examples = input.exampleIds.length
    ? await db
        .select()
        .from(jobs)
        .where(
          and(
            inArray(jobs.id, input.exampleIds),
            eq(jobs.kind, "material"),
            eq(jobs.targetId, projectId),
            eq(jobs.status, "done"),
          ),
        )
    : [];
  if (examples.length !== new Set(input.exampleIds).size)
    throw new Error(
      "Examples must be completed materials from this collection",
    );
  const referenceImages = examples.map(
    (example) => `materials/${example.id}/output/review.png`,
  );
  await db.transaction(async (tx) => {
    await tx.insert(jobs).values({
      id,
      kind: "material",
      targetId: projectId,
      checkpoint: {
        parameters: JSON.stringify(input.parameters),
        description: input.prompt,
        design: project.design,
        guidance: JSON.stringify(project.workshop || {}),
        pipeline: "material-review:1",
        materialId,
        referenceImages: JSON.stringify(referenceImages),
        reviewRounds: String(input.prompt ? input.reviewRounds : 0),
        ...(parent
          ? {
              parentId: parent.id,
              previousImage: `materials/${parent.id}/output/review.png`,
            }
          : {}),
      },
    });
    await tx.insert(materialVersions).values({
      id,
      jobId: id,
      materialId,
      parentId: parent?.id,
      projectId,
      snapshot: {
        parameters: input.parameters,
        description: input.prompt,
        design: project.design,
        guidance: project.workshop || {},
        exampleIds: input.exampleIds,
        referenceImages,
        reviewRounds: input.prompt ? input.reviewRounds : 0,
      },
    });
  });
  return Response.json({ id }, { status: 201 });
}

export async function renderMaterial(projectId: string) {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing material job context");
  if (job.checkpoint.applied === "yes") return;
  let params = materialSchema.parse(JSON.parse(job.checkpoint.parameters));
  if (
    job.checkpoint.description &&
    !job.checkpoint.plan &&
    !job.checkpoint.pipeline
  ) {
    const { result, runId } = await runRole({
      role: "material-planner",
      projectId,
      input: await roleInput("material-planner", {
        description: job.checkpoint.description,
        design: job.checkpoint.design,
        guidance: job.checkpoint.guidance,
        parameters: JSON.stringify(params),
      }),
    });
    params = materialSchema.parse({
      ...result.parameters,
      size: params.size,
      seed: params.seed,
    });
    await checkpoint("parameters", JSON.stringify(params));
    await checkpoint("notes", result.notes);
    await checkpoint("plan", runId);
  }
  const directory = `materials/${job.id}`,
    root = resolve(DATA, directory);
  await mkdir(root, { recursive: true });
  if (job.checkpoint.prepared !== "yes") {
    for (const name of materialSupport)
      await copyFile(resolve("blender/materials", name), resolve(root, name));
    await writeFile(
      resolve(root, "params.json"),
      JSON.stringify(params, null, 2),
    );
    await writeFile(
      resolve(root, "build-request.json"),
      JSON.stringify(
        {
          description: job.checkpoint.description,
          design: job.checkpoint.design,
          guidance: job.checkpoint.guidance,
          notes: job.checkpoint.notes,
          toolkitVersion: "2.0.0",
          runnerProtocol: 2,
          parentId: job.checkpoint.parentId,
        },
        null,
        2,
      ),
    );
    await writeFile(
      resolve(root, "asset.py"),
      "from materialkit import build_material\n\ndef build(params):\n    return build_material(params)\n",
    );
    if (job.checkpoint.parentId)
      await copyFile(
        resolve(DATA, `materials/${job.checkpoint.parentId}/asset.py`),
        resolve(root, "asset.py"),
      );
    await writeFile(
      resolve(root, "README.txt"),
      "Install Python 3.11+ and run: python -m pip install -r requirements.txt\nThen: python render.py --mode final\nQuick preview: python render.py --mode quick\nEdit asset.py or params.json to make a new local variant. Match recorded toolchain versions for reproducibility.\nAlbedo is sRGB; data maps are linear. Normal is OpenGL +Y. ORM packs AO/Roughness/Metallic into R/G/B.\n",
    );
    await checkpoint("prepared", "yes");
  }
  const python =
    process.env.STUDIO_PYTHON ||
    (process.platform === "win32"
      ? resolve(".venv/Scripts/python.exe")
      : resolve(".venv/bin/python"));
  if (
    job.checkpoint.description &&
    job.checkpoint.pipeline === "material-review:1"
  ) {
    if (job.checkpoint.reviewed !== "yes")
      await reviewMaterial(projectId, root, params, python);
  } else
    await runExportProcess(
      python,
      [resolve(root, "render.py"), "--mode", "final"],
      root,
      180000,
    );
  if (job.checkpoint.pipeline) await readReceipt(resolve(root, "output"));
  const metadata = JSON.parse(
    await readFile(resolve(root, "output/material.json"), "utf8"),
  );
  if (
    JSON.stringify(materialSchema.parse(metadata.parameters)) !==
    JSON.stringify(params)
  )
    throw new Error("Material parameters differ from the saved recipe");
  await checkpoint("validation", JSON.stringify(metadata.validation));
  await exportBundle(directory);
  const files = [
    "albedo.png",
    "roughness.png",
    "metallic.png",
    "normal.png",
    "height.png",
    "ao.png",
    "orm.png",
    "review.png",
    ...((await readFile(resolve(root, "output/lighting.png")).then(
      () => true,
      () => false,
    ))
      ? ["lighting.png"]
      : []),
    ...((await readFile(resolve(root, "output/calibration.json")).then(
      () => true,
      () => false,
    ))
      ? ["calibration.json"]
      : []),
    "material.json",
    "manifest.json",
    ...(job.checkpoint.pipeline ? ["build-receipt.json"] : []),
  ].map((name) => `${directory}/output/${name}`);
  files.push(
    `${directory}/source.zip`,
    `${directory}/delivery.zip`,
    `${directory}/build-manifest.json`,
  );
  await assertJobActive();
  await publishFiles(files);
  await checkpoint("files", JSON.stringify(files));
  if (job.checkpoint.pipeline)
    await db
      .update(materialVersions)
      .set({
        outcome: job.checkpoint.outcome || "unreviewed",
        result: {
          files,
          parameters: params,
          validation: metadata.validation,
          review: job.checkpoint.review
            ? JSON.parse(job.checkpoint.review)
            : null,
        },
      })
      .where(eq(materialVersions.id, job.id));
  await checkpoint("applied", "yes");
}
