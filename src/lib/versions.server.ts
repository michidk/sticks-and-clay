import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  readdir,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { DATA, publishFiles } from "./storage.server";

export async function archiveVersion(runId: string, directory: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error("Builder run not found");
  const result = run.result as Record<string, any>;
  if (result?.artifacts) return result.artifacts;
  const destination = `versions/${runId}`;
  const temporary = resolve(DATA, `versions/.${runId}-${crypto.randomUUID()}`);
  await mkdir(temporary, { recursive: true });
  const textures: { key: string; name: string; kind: string }[] = [];
  try {
    for (const file of [
      "asset.glb",
      "source.blend",
      "front.png",
      "rear.png",
      "detail.png",
      "metrics.json",
    ]) {
      await copyFile(resolve(DATA, directory, file), resolve(temporary, file));
    }
    await mkdir(resolve(temporary, "textures"), { recursive: true });
    // Keep generated source images plus the exact embedded textures used in the GLB.
    const sourceTextures = resolve(DATA, directory, "textures");
    for (const file of await readdir(sourceTextures).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })) {
      if (!/^[a-zA-Z0-9_.-]+\.(png|jpg|webp)$/.test(file)) continue;
      await copyFile(
        resolve(sourceTextures, file),
        resolve(temporary, "textures", "source-" + file),
      );
      textures.push({
        key: `${destination}/textures/source-${file}`,
        name: file,
        kind: "Source / generated",
      });
    }
    const glb = await readFile(resolve(temporary, "asset.glb"));
    const jsonLength = glb.readUInt32LE(12);
    const manifest = JSON.parse(glb.toString("utf8", 20, 20 + jsonLength));
    const binStart = 20 + jsonLength + 8;
    for (const [index, image] of (manifest.images || []).entries()) {
      const buffer = manifest.bufferViews?.[image.bufferView];
      if (
        !buffer ||
        !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)
      )
        continue;
      const extension =
        image.mimeType === "image/jpeg"
          ? "jpg"
          : image.mimeType === "image/webp"
            ? "webp"
            : "png";
      const file = `embedded-${index}.${extension}`;
      const start = binStart + (buffer.byteOffset || 0);
      await writeFile(
        resolve(temporary, "textures", file),
        glb.subarray(start, start + buffer.byteLength),
      );
      textures.push({
        key: `${destination}/textures/${file}`,
        name: image.name || `Texture ${index + 1}`,
        kind: "Used in GLB",
      });
    }
    await writeFile(
      resolve(temporary, "textures.json"),
      JSON.stringify(textures),
    );
    await rename(temporary, resolve(DATA, destination)).catch(async (error) => {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const artifacts = {
    textures: JSON.parse(
      await readFile(resolve(DATA, destination, "textures.json"), "utf8").catch(
        () => "[]",
      ),
    ),
    glb: `${destination}/asset.glb`,
    blend: `${destination}/source.blend`,
    renders: ["front", "rear", "detail"].map((v) => `${destination}/${v}.png`),
    metrics: JSON.parse(
      await readFile(resolve(DATA, destination, "metrics.json"), "utf8"),
    ),
  };
  await publishFiles([
    artifacts.glb,
    artifacts.blend,
    ...artifacts.renders,
    `${destination}/metrics.json`,
    `${destination}/textures.json`,
    ...artifacts.textures.map((texture: { key: string }) => texture.key),
  ]);
  await db
    .update(runs)
    .set({ result: { ...result, artifacts } })
    .where(eq(runs.id, runId));
  return artifacts;
}
