import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "../db/client";
import { projects, batches, runs, models, jobs } from "../db/schema";
import { DATA, publishFiles } from "./storage.server";
import { snapshotWorkshop } from "./workshop.server";
import { jobContext, checkpoint } from "./checkpoint.server";
import { assertJobActive } from "./queue.server";
import { REVIEW_VIEWS } from "./photo-views";

const uuid = z.string().uuid();
export async function workshopAction(
  request: Request,
  path: string[],
): Promise<Response | null> {
  if (path[0] === "workshop-jobs" && path[1] && request.method === "GET") {
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, uuid.parse(path[1])));
    if (!job || job.kind !== "presentation")
      return Response.json(
        { error: "Presentation not found" },
        { status: 404 },
      );
    return Response.json({
      status: job.status,
      error: job.error,
      files: job.checkpoint.files ? JSON.parse(job.checkpoint.files) : [],
    });
  }
  if (
    path[0] === "projects" &&
    path[2] === "import" &&
    request.method === "POST"
  ) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, uuid.parse(path[1])));
    if (!project || project.assetType !== "model" || project.status !== "ready")
      throw new Error("Approve a 3D project before importing a baseline");
    const form = await request.formData(),
      file = form.get("file");
    if (!(file instanceof File) || file.size > 200 * 1024 * 1024)
      throw new Error("Choose a GLB or Blender source up to 200 MB");
    const bytes = Buffer.from(await file.arrayBuffer());
    const extension =
      bytes.subarray(0, 7).toString() === "BLENDER"
        ? "blend"
        : bytes.length >= 20 &&
            bytes.toString("ascii", 0, 4) === "glTF" &&
            bytes.readUInt32LE(4) === 2 &&
            bytes.readUInt32LE(8) === bytes.length
          ? "glb"
          : null;
    if (!extension) throw new Error("Invalid GLB or Blender source");
    const name = z.string().trim().min(1).max(100).parse(form.get("name")),
      prompt = z.string().trim().min(3).max(12000).parse(form.get("prompt"));
    const key = `imports/${crypto.randomUUID()}.${extension}`;
    await mkdir(resolve(DATA, "imports"), { recursive: true });
    await writeFile(resolve(DATA, key), bytes);
    await publishFiles([key]);
    const id = crypto.randomUUID(),
      batchId = crypto.randomUUID(),
      workshop = await snapshotWorkshop(project.id, project.workshop);
    await db.transaction(async (tx) => {
      await tx.insert(batches).values({
        id: batchId,
        projectId: project.id,
        prompt,
        count: 1,
        judgeIterations: 2,
        design: project.design,
        designVersion: project.designVersion,
        workshop,
        status: "building",
      });
      await tx
        .insert(models)
        .values({ id, projectId: project.id, batchId, name, prompt });
      await tx.insert(jobs).values({
        id: crypto.randomUUID(),
        kind: "model",
        targetId: id,
        checkpoint: { "import-baseline": key },
      });
    });
    return Response.json({ id }, { status: 201 });
  }
  if (
    path[0] === "models" &&
    path[2] === "presentation" &&
    request.method === "POST"
  ) {
    const input = z
      .object({ sourceRunId: uuid, sprites: z.boolean().default(false) })
      .parse(await request.json());
    const [source] = await db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.id, input.sourceRunId),
          eq(runs.modelId, uuid.parse(path[1])),
          eq(runs.role, "builder"),
          eq(runs.status, "done"),
        ),
      );
    if (!(source?.result as any)?.artifacts?.glb)
      throw new Error("Choose a completed source version");
    const id = crypto.randomUUID();
    await db.insert(jobs).values({
      id,
      kind: "presentation",
      targetId: path[1],
      checkpoint: { sourceRunId: source!.id, sprites: String(input.sprites) },
    });
    return Response.json({ id }, { status: 201 });
  }
  return null;
}

/** No AI role or token cost; outputs never overwrite the selected asset version. */
export async function renderPresentation() {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing presentation job");
  const [source] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, job.checkpoint.sourceRunId));
  const artifacts = (source?.result as any)?.artifacts;
  if (!artifacts?.glb) throw new Error("Source version is unavailable");
  const directory = `presentations/${job.id}`,
    destination = resolve(DATA, directory);
  await mkdir(destination, { recursive: true });
  const script = resolve(destination, "render.py"),
    literal = (value: unknown) => JSON.stringify(value);
  let code = await readFile("blender/photograph.py", "utf8");
  code += `\nphotograph(${literal(resolve(DATA, artifacts.glb))},${literal(destination)},coverage=${literal(REVIEW_VIEWS)})\n`;
  if (job.checkpoint.sprites === "true") {
    code += `
import sys
sys.path.insert(0,${literal(resolve("blender"))})
from assetkit.sprites import render_sheet, sample_frames
scene=bpy.context.scene
frames=sample_frames(scene)
scene.frame_start=min(frames)
scene.frame_end=max(frames)
meshes=[o for o in scene.objects if o.type=='MESH' and not o.get('studio_environment')]
points=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
lo=Vector([min(p[i] for p in points) for i in range(3)])
hi=Vector([max(p[i] for p in points) for i in range(3)])
render_sheet(scene,scene.camera,(lo+hi)/2,max(hi-lo),${literal(destination)},{"directions":8,"size":128,"frames":frames})
`;
  }
  await writeFile(script, code);
  await assertJobActive();
  const controller = new AbortController();
  const timer = setInterval(
    () => void assertJobActive().catch(() => controller.abort()),
    500,
  );
  try {
    await promisify(execFile)(
      process.env.BLENDER_BIN || "blender",
      [
        "-b",
        "--factory-startup",
        "--threads",
        "2",
        "--python-exit-code",
        "1",
        "--python",
        script,
      ],
      {
        timeout: 900000,
        maxBuffer: 4 * 1024 * 1024,
        signal: controller.signal,
      },
    );
  } finally {
    clearInterval(timer);
  }
  await assertJobActive();
  const files = [
    ...REVIEW_VIEWS.map((v) => `${directory}/${v}.png`),
    `${directory}/photography.json`,
    ...(job.checkpoint.sprites === "true"
      ? [`${directory}/sprites.png`, `${directory}/sprites.json`]
      : []),
  ];
  await publishFiles(files);
  await checkpoint("files", JSON.stringify(files));
  await checkpoint("applied", "yes");
}
