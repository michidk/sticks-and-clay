import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../db/client";
import { projects, batches, runs, models, jobs } from "../db/schema";
import { DATA, publishFiles } from "./storage.server";
import { snapshotWorkshop } from "./workshop.server";
import { jobContext, checkpoint } from "./checkpoint.server";
import { assertJobActive } from "./queue.server";
import { REVIEW_VIEWS } from "./photo-views";
import { spriteOptionsSchema } from "./sprites";
import {
  savedExport,
  exportBundle,
  runExportProcess,
  readReceipt,
} from "../modules/asset-builds/index.server";
import { copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createAssignment } from "../modules/materials/assignment.server";

const uuid = z.string().uuid();
export async function workshopAction(
  request: Request,
  path: string[],
): Promise<Response | null> {
  if (
    path[0] === "models" &&
    path[2] === "material-assignment" &&
    request.method === "POST"
  )
    return Response.json(
      await createAssignment(path[1], await request.json()),
      { status: 201 },
    );
  if (
    path[0] === "models" &&
    path[2] === "sprite-clips" &&
    request.method === "GET"
  ) {
    const sourceRunId = uuid.parse(
      new URL(request.url).searchParams.get("sourceRunId"),
    );
    const [source] = await db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.id, sourceRunId),
          eq(runs.modelId, uuid.parse(path[1])),
          eq(runs.status, "done"),
        ),
      );
    const key = (source?.result as { artifacts?: { glb?: string } })?.artifacts
      ?.glb;
    if (!key) throw new Error("Choose a completed model version");
    const bytes = await readFile(resolve(DATA, key));
    if (bytes.toString("ascii", 0, 4) !== "glTF")
      throw new Error("Invalid model file");
    const doc = JSON.parse(
      bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
    );
    return Response.json(
      (doc.animations || []).map((a: { name?: string }, i: number) => ({
        name: a.name || `Animation_${i}`,
        index: i,
      })),
    );
  }
  if (
    path[0] === "models" &&
    path[2] === "workshop-jobs" &&
    request.method === "GET"
  ) {
    const saved = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.targetId, uuid.parse(path[1])),
          eq(jobs.kind, "presentation"),
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(40);
    return Response.json(saved.map(savedExport));
  }
  if (path[0] === "workshop-jobs" && path[1] && request.method === "GET") {
    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, uuid.parse(path[1])));
    if (
      !job ||
      !["presentation", "material", "material-assignment"].includes(job.kind)
    )
      return Response.json(
        { error: "Presentation not found" },
        { status: 404 },
      );
    return Response.json(savedExport(job));
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
      .object({
        sourceRunId: uuid,
        sprites: z.boolean().default(false),
        spriteOptions: spriteOptionsSchema.optional(),
      })
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
      checkpoint: {
        sourceRunId: source!.id,
        sprites: String(input.sprites),
        ...(input.spriteOptions
          ? { spriteOptions: JSON.stringify(input.spriteOptions) }
          : {}),
      },
    });
    return Response.json({ id }, { status: 201 });
  }
  return null;
}

/** No AI role or token cost; outputs never overwrite the selected asset version. */
export async function renderPresentation() {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing presentation job");
  if (job.checkpoint.applied === "yes") return;
  const [source] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, job.checkpoint.sourceRunId));
  const artifacts = (source?.result as any)?.artifacts;
  if (!artifacts?.glb) throw new Error("Source version is unavailable");
  const directory = `presentations/${job.id}`,
    destination = resolve(DATA, directory);
  await mkdir(destination, { recursive: true });
  if (job.checkpoint.sprites === "true") {
    if (job.checkpoint.prepared !== "yes") {
      await copyFile(
        resolve(DATA, artifacts.glb),
        resolve(destination, "source.glb"),
      );
      await mkdir(resolve(destination, "assetkit"), { recursive: true });
      for (const name of [
        "sprites.py",
        "pixel.py",
        "timeline.py",
        "sprite_metadata.py",
      ])
        await copyFile(
          resolve("blender/assetkit", name),
          resolve(destination, "assetkit", name),
        );
      await writeFile(resolve(destination, "assetkit/__init__.py"), "");
      await copyFile(
        resolve("blender/sprite_render.py"),
        resolve(destination, "sprite_render.py"),
      );
      await copyFile(
        resolve("blender/sprite_launcher.py"),
        resolve(destination, "render.py"),
      );
      await copyFile(
        resolve("blender/build_runtime.py"),
        resolve(destination, "build_runtime.py"),
      );
      await copyFile(
        resolve("blender/build_artifacts.py"),
        resolve(destination, "build_artifacts.py"),
      );
      const options = job.checkpoint.spriteOptions
        ? spriteOptionsSchema.parse(JSON.parse(job.checkpoint.spriteOptions))
        : {
            ...spriteOptionsSchema.parse({}),
            pixel: false,
            size: 128,
            frameCount: 3,
          };
      await writeFile(
        resolve(destination, "params.json"),
        JSON.stringify(options, null, 2),
      );
      await writeFile(
        resolve(destination, "README.txt"),
        "Install Python 3 and Blender. Run python render.py --blender PATH.\nThe bundled source GLB is unchanged. Edit params.json for directions, size, frames, clip, palette and outline.\nSprite rows are frames and columns are directions. Match recorded Blender version for reproducibility.\n",
      );
      await checkpoint("prepared", "yes");
    }
    await runExportProcess(
      process.env.BLENDER_BIN || "blender",
      [
        "-b",
        "--factory-startup",
        "--threads",
        "2",
        "--python-exit-code",
        "1",
        "--python",
        resolve(destination, "sprite_render.py"),
      ],
      destination,
      900000,
    );
    // Legacy pinned runners predate the versioned artifact receipt.
    if (
      await readFile(resolve(destination, "build_artifacts.py")).then(
        () => true,
        () => false,
      )
    )
      await readReceipt(resolve(destination, "output"));
    const receipt = JSON.parse(
      await readFile(resolve(destination, "output/receipt.json"), "utf8"),
    );
    const original = await readFile(resolve(DATA, artifacts.glb));
    if (
      receipt.sourceSha256 !==
      createHash("sha256").update(original).digest("hex")
    )
      throw new Error("Sprite source differs from the selected version");
    await exportBundle(directory);
    const files = [
      "output/sprites.png",
      "output/sprites.json",
      "output/receipt.json",
      ...((await readFile(
        resolve(destination, "output/sprite-checks.json"),
      ).then(
        () => true,
        () => false,
      ))
        ? ["output/sprite-checks.json"]
        : []),
      ...((await readFile(
        resolve(destination, "output/build-receipt.json"),
      ).then(
        () => true,
        () => false,
      ))
        ? ["output/build-receipt.json"]
        : []),
      "source.zip",
      "delivery.zip",
      "build-manifest.json",
    ].map((name) => `${directory}/${name}`);
    const sheet = JSON.parse(
      await readFile(resolve(destination, "output/sprites.json"), "utf8"),
    );
    for (const cell of sheet.cells)
      if (cell.file) files.push(`${directory}/output/${cell.file}`);
    for (const name of await readdir(resolve(destination, "output")))
      if (/^review-[a-z]+-f[0-9]+-d[0-9]+\.png$/.test(name))
        files.push(`${directory}/output/${name}`);
    await assertJobActive();
    await publishFiles(files);
    await checkpoint("files", JSON.stringify(files));
    await checkpoint("applied", "yes");
    return;
  }
  const script = resolve(destination, "render.py"),
    literal = (value: unknown) => JSON.stringify(value);
  let code = await readFile("blender/photograph.py", "utf8");
  code += `\nphotograph(${literal(resolve(DATA, artifacts.glb))},${literal(destination)},coverage=${literal(REVIEW_VIEWS)})\n`;
  await writeFile(script, code);
  await assertJobActive();
  await runExportProcess(
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
    destination,
    900000,
  );
  await assertJobActive();
  const files = [
    ...REVIEW_VIEWS.map((v) => `${directory}/${v}.png`),
    `${directory}/photography.json`,
  ];
  await publishFiles(files);
  await checkpoint("files", JSON.stringify(files));
  await checkpoint("applied", "yes");
}
