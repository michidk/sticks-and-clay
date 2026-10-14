import { readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { jobs } from "../../db/schema";
import { DATA } from "../../lib/storage.server";
import { assertJobActive } from "../../lib/queue.server";
import { bundleFiles, writeSourceZip } from "../../lib/source-bundle.server";
import { receiptSchema } from "./contracts";
import { committedDirectory } from "./publication.server";

export async function readReceipt(directory: string) {
  directory = await committedDirectory(directory);
  const receipt = receiptSchema.parse(
    JSON.parse(
      await readFile(resolve(directory, "build-receipt.json"), "utf8"),
    ),
  );
  for (const artifact of receipt.artifacts) {
    const bytes = await readFile(resolve(directory, artifact.path));
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256)
      throw new Error(`Artifact checksum mismatch: ${artifact.id}`);
  }
  return receipt;
}

export async function commitGeneratedBuild(
  candidate: string,
  destination: string,
  kind: "photography" | "model",
  inputHash: string,
) {
  await copyFile(
    resolve("blender/build_artifacts.py"),
    resolve(candidate, "build_artifacts.py"),
  );
  const python =
    process.env.STUDIO_PYTHON ||
    resolve(
      process.platform === "win32"
        ? ".venv/Scripts/python.exe"
        : ".venv/bin/python",
    );
  await runExportProcess(
    python,
    [
      "-c",
      "import pathlib,sys;from build_artifacts import receipt,publish_workspace;p=pathlib.Path('.');receipt(p,sys.argv[2],'final',sys.argv[3],{'runner':'3'});publish_workspace(p,pathlib.Path(sys.argv[1]),[x.name for x in p.iterdir() if x.suffix in ('.png','.json','.glb','.blend')])",
      destination,
      kind,
      inputHash,
    ],
    candidate,
    60000,
  );
  await readReceipt(destination);
  await rm(candidate, { recursive: true, force: true });
}

export function savedExport(job: typeof jobs.$inferSelect) {
  return {
    version: 1 as const,
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
    outcome: job.checkpoint.outcome || "unreviewed",
    parentId: job.checkpoint.parentId,
    materialId: job.checkpoint.materialId,
    review: job.checkpoint.review
      ? JSON.parse(job.checkpoint.review)
      : undefined,
    reviews: job.checkpoint.reviews ? JSON.parse(job.checkpoint.reviews) : [],
    validation: job.checkpoint.validation
      ? JSON.parse(job.checkpoint.validation)
      : undefined,
    files:
      job.status === "done" && job.checkpoint.files
        ? JSON.parse(job.checkpoint.files)
        : [],
  };
}

/** Cancellation is shared with existing queue actions; local builds make no API calls. */
/** The last few stderr lines, without Blender's harmless container warning. */
export function blenderFailure(stderr = "") {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.includes("mounted file-systems"))
    .slice(-3)
    .join("\n");
}

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
    const python =
      process.env.STUDIO_PYTHON ||
      resolve(
        process.platform === "win32"
          ? ".venv/Scripts/python.exe"
          : ".venv/bin/python",
      );
    const supervised = /blender(?:\.exe)?$/i.test(binary);
    const result = await promisify(execFile)(
      python,
      [
        resolve("blender/build_runtime.py"),
        "--cwd",
        cwd,
        "--timeout",
        String(Math.ceil(timeout / 1000)),
        ...(supervised ? [] : ["--cpu"]),
        "--",
        binary,
        ...args,
      ],
      {
        cwd,
        env: {
          ...process.env,
          STUDIO_MATERIAL_CACHE: resolve(DATA, "material-cache"),
        },
        timeout: timeout + 3000,
        maxBuffer: 4 * 1024 * 1024,
        signal: controller.signal,
      },
    );
    await writeFile(resolve(cwd, "process.log"), result.stdout + result.stderr);
  } catch (error) {
    const failure = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    await writeFile(
      resolve(cwd, "process.log"),
      `${failure.stdout || ""}${failure.stderr || ""}\n${failure.message}`,
    );
    const kind = controller.signal.aborted
      ? "cancelled"
      : failure.code === 124
        ? "timeout"
        : failure.code === "ENOENT"
          ? "dependency"
          : "runner";
    await writeFile(
      resolve(cwd, "process-failure.json"),
      JSON.stringify({ kind, message: failure.message }, null, 2),
    );
    // The raw message leads with the full supervisor command line.
    if (kind === "timeout")
      throw new Error(
        `Blender did not finish within the ${Math.round(timeout / 60_000)} minute limit. Raise it under Settings › Timeouts, then retry.`,
        { cause: error },
      );
    if (kind === "runner")
      throw new Error(blenderFailure(failure.stderr) || failure.message, {
        cause: error,
      });
    throw error;
  } finally {
    clearInterval(timer);
  }
  await assertJobActive();
}

export async function exportBundle(directory: string) {
  const started = performance.now(),
    rssBefore = process.memoryUsage().rss;
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
          sha256: f.sha256,
        })),
      },
      null,
      2,
    ),
  );
  await writeFile(resolve(root, "build-manifest.json"), manifest);
  await writeSourceZip(resolve(root, "source.zip"), [
    ...files,
    { name: "build-manifest.json", bytes: manifest },
  ]);
  const receiptFile = files.find((f) => f.name === "output/build-receipt.json");
  const receiptPaths = receiptFile
    ? new Set(
        (await readReceipt(resolve(root, "output"))).artifacts.map(
          (artifact) => `output/${artifact.path}`,
        ),
      )
    : undefined;
  const delivery = files.filter(
    (f) =>
      (receiptPaths
        ? receiptPaths.has(f.name) || f.name === "output/build-receipt.json"
        : f.name.startsWith("output/")) ||
      ["derived.glb", "assignment.json"].includes(f.name),
  );
  if (delivery.length) {
    const instructions = Buffer.from(
      "Runtime assets only. PBR: sRGB albedo, linear data maps, OpenGL +Y normals; ORM channels are AO/roughness/metallic. Consult material.json for tile scale and height units. Sprites: rows are frames, columns are directions; sprites.json records pivots, source times and playback FPS. Source GLBs are preserved; derived.glb contains an explicit material assignment.\n",
    );
    await writeSourceZip(resolve(root, "delivery.zip"), [
      ...delivery,
      { name: "IMPORT.txt", bytes: instructions },
    ]);
  }
  await writeFile(
    resolve(root, "bundle-stats.json"),
    JSON.stringify(
      {
        version: 1,
        files: files.length,
        inputBytes: files.reduce((sum, f) => sum + f.size, 0),
        milliseconds: performance.now() - started,
        rssBefore,
        rssAfter: process.memoryUsage().rss,
      },
      null,
      2,
    ),
  );
}
