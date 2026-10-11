import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { db } from "../db/client";
import { jobs, projects } from "../db/schema";
import { materialSchema } from "./materials";
import { DATA, publishFiles } from "./storage.server";
import { assertJobActive } from "./queue.server";
import { checkpoint, jobContext } from "./checkpoint.server";
import { bundleFiles, sourceZip } from "./source-bundle.server";
import { runRole, roleInput } from "../modules/ai/index.server";

export function savedExport(job: typeof jobs.$inferSelect) {
  return {
    id: job.id,
    kind: job.kind,
    sourceRunId: job.checkpoint.sourceRunId,
    createdAt: job.createdAt,
    status: job.status,
    error: job.error,
    parameters: job.checkpoint.parameters
      ? JSON.parse(job.checkpoint.parameters)
      : undefined,
    notes: job.checkpoint.notes,
    validation: job.checkpoint.validation
      ? JSON.parse(job.checkpoint.validation)
      : undefined,
    files:
      job.status === "done" && job.checkpoint.files
        ? JSON.parse(job.checkpoint.files)
        : [],
  };
}

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
  if (project.status !== "ready")
    throw new Error(
      "Approve the collection design before generating materials",
    );
  const input = z
    .object({
      parameters: materialSchema,
      prompt: z.string().trim().max(12000).default(""),
    })
    .parse(await request.json());
  const id = crypto.randomUUID();
  await db
    .insert(jobs)
    .values({
      id,
      kind: "material",
      targetId: projectId,
      checkpoint: {
        parameters: JSON.stringify(input.parameters),
        description: input.prompt,
        design: project.design,
        guidance: JSON.stringify(project.workshop || {}),
      },
    });
  return Response.json({ id }, { status: 201 });
}

/** Cancellation is shared with existing queue actions; local builds make no API calls. */
export async function runExportProcess(
  binary: string,
  args: string[],
  cwd: string,
  timeout: number,
) {
  await assertJobActive();
  const controller = new AbortController();
  const timer = setInterval(
    () => void assertJobActive().catch(() => controller.abort()),
    500,
  );
  try {
    await promisify(execFile)(binary, args, {
      cwd,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      signal: controller.signal,
    });
  } finally {
    clearInterval(timer);
  }
  await assertJobActive();
}

export async function exportBundle(directory: string) {
  const root = resolve(DATA, directory);
  const files = (await bundleFiles(root)).filter(
    (f) => f.name !== "source.zip" && f.name !== "build-manifest.json",
  );
  const manifest = Buffer.from(
    JSON.stringify(
      {
        version: 1,
        files: files.map((f) => ({
          name: f.name,
          sha256: createHash("sha256").update(f.bytes).digest("hex"),
        })),
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(root, "build-manifest.json"), manifest);
  await writeFile(
    resolve(root, "source.zip"),
    sourceZip([...files, { name: "build-manifest.json", bytes: manifest }]),
  );
}

export async function renderMaterial(projectId: string) {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing material job context");
  if (job.checkpoint.applied === "yes") return;
  let params = materialSchema.parse(JSON.parse(job.checkpoint.parameters));
  if (job.checkpoint.description && !job.checkpoint.plan) {
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
    for (const name of ["materialkit.py", "render.py", "requirements.txt"])
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
        },
        null,
        2,
      ),
    );
    await writeFile(
      resolve(root, "asset.py"),
      "from materialkit import build_material\n\ndef build(params):\n    return build_material(params)\n",
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
  await runExportProcess(
    python,
    [resolve(root, "render.py"), "--mode", "final"],
    root,
    180000,
  );
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
    "material.json",
    "manifest.json",
  ].map((name) => `${directory}/output/${name}`);
  files.push(`${directory}/source.zip`, `${directory}/build-manifest.json`);
  await assertJobActive();
  await publishFiles(files);
  await checkpoint("files", JSON.stringify(files));
  await checkpoint("applied", "yes");
}
