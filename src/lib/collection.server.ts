import { assertJobActive } from "./queue.server";
import { eq } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../db/client";
import { batches, models } from "../db/schema";
import { DATA, filePath, publishFiles } from "./storage.server";

export const COLLECTION_FRONT_AZIMUTH = -55;

export function photographyFrontAzimuth(receipt: unknown) {
  const value = (receipt as { settings?: { frontAzimuth?: unknown } })
    ?.settings?.frontAzimuth;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : COLLECTION_FRONT_AZIMUTH;
}

async function assetFrontAzimuth(artifacts: Record<string, unknown>) {
  const manifest = (
    artifacts.photography as { manifest?: unknown } | undefined
  )?.manifest;
  if (typeof manifest !== "string") return COLLECTION_FRONT_AZIMUTH;
  return photographyFrontAzimuth(
    JSON.parse(await readFile(await filePath(manifest), "utf8")),
  );
}

export async function renderCollection(batchId: string) {
  const assets = await db
    .select()
    .from(models)
    .where(eq(models.batchId, batchId));
  const ready = assets.filter(
    (m) =>
      m.status === "done" && m.artifacts && m.artifacts.stage !== "geometry",
  );
  if (!ready.length) {
    // A v1 worker may have queued a demo just before the geometry-gate upgrade.
    if (assets.some((m) => m.artifacts?.stage === "geometry")) {
      if (
        assets.every((m) => ["done", "failed", "cancelled"].includes(m.status))
      )
        await db
          .update(batches)
          .set({ status: "completed_with_errors" })
          .where(eq(batches.id, batchId));
      return;
    }
    throw new Error("No completed assets to render");
  }
  const directory = `collections/${batchId}/${crypto.randomUUID()}`,
    output = resolve(DATA, directory);
  await mkdir(output, { recursive: true });
  const config = {
    output,
    frontAzimuth: COLLECTION_FRONT_AZIMUTH,
    assets: await Promise.all(
      ready.map(async (m) => ({
        name: m.name,
        path: await filePath(String(m.artifacts!.glb)),
        frontAzimuth: await assetFrontAzimuth(m.artifacts!),
      })),
    ),
  };
  const configPath = resolve(output, "scene.json");
  await writeFile(configPath, JSON.stringify(config));
  const proc = Bun.spawn(
    [
      process.env.BLENDER_BIN || "blender",
      "-b",
      "--threads",
      "2",
      "--python-exit-code",
      "1",
      "--python",
      resolve("blender/collection.py"),
      "--",
      configPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const cancellation = setInterval(() => {
    void assertJobActive().catch(() => proc.kill());
  }, 1000);
  const timer = setTimeout(() => proc.kill(), 240000);
  try {
    const [exit, out, err] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await writeFile(resolve(output, "render.log"), out + err);
    if (exit !== 0)
      throw new Error("Collection rendering failed: " + err.slice(-1000));
    await assertJobActive();
    await publishFiles(
      ["lineup.png", "scene.png", "collection.blend"].map(
        (file) => `${directory}/${file}`,
      ),
    );
    await db
      .update(batches)
      .set({
        status: assets.some(
          (m) => m.status !== "done" || m.verdict === "limit_reached",
        )
          ? "completed_with_errors"
          : "done",
        preview: {
          lineup: `${directory}/lineup.png`,
          scene: `${directory}/scene.png`,
          blend: `${directory}/collection.blend`,
        },
      })
      .where(eq(batches.id, batchId));
  } finally {
    clearTimeout(timer);
    clearInterval(cancellation);
  }
}
