import {
  runExportProcess,
  commitGeneratedBuild,
} from "../modules/asset-builds/index.server";
import { createHash } from "node:crypto";
import { assertJobActive } from "./queue.server";
import { eq } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../db/client";
import { batches, models, projects } from "../db/schema";
import { renderGraphicSheet } from "./graphic-sheet.server";
import { DATA, filePath, publishFiles } from "./storage.server";
import { loadRuntimeSettings } from "./runtime-settings.server";

export const COLLECTION_FRONT_AZIMUTH = -55;

export function photographyFrontAzimuth(receipt: unknown) {
  const value = (receipt as { settings?: { frontAzimuth?: unknown } })?.settings
    ?.frontAzimuth;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : COLLECTION_FRONT_AZIMUTH;
}

async function assetFrontAzimuth(artifacts: Record<string, unknown>) {
  const manifest = (artifacts.photography as { manifest?: unknown } | undefined)
    ?.manifest;
  if (typeof manifest !== "string") return COLLECTION_FRONT_AZIMUTH;
  return photographyFrontAzimuth(
    JSON.parse(await readFile(await filePath(manifest), "utf8")),
  );
}

export async function renderCollection(batchId: string) {
  const [owner] = await db
    .select({ assetType: projects.assetType })
    .from(batches)
    .innerJoin(projects, eq(projects.id, batches.projectId))
    .where(eq(batches.id, batchId));
  // Each asset type renders its own collection view; 3D uses the Blender scene below.
  if (owner && owner.assetType !== "model") return renderGraphicSheet(batchId);
  const settings = await loadRuntimeSettings();
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
  const candidate = resolve(output, `.candidate-${crypto.randomUUID()}`);
  await mkdir(candidate);
  const config = {
    output: candidate,
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
  await runExportProcess(
    process.env.BLENDER_BIN || "blender",
    [
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
    output,
    settings.timeouts.collectionMs,
  );
  await assertJobActive();
  await commitGeneratedBuild(
    candidate,
    output,
    "photography",
    createHash("sha256").update(JSON.stringify(config.assets)).digest("hex"),
  );
  await publishFiles(
    ["lineup.png", "scene.png", "collection.blend", "build-receipt.json"].map(
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
}
