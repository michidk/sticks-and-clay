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
import { cleanupGlb } from "../modules/glb/cleanup";
import { handoverGlb } from "../modules/glb/handover";
import { DATA, publishFiles } from "./storage.server";

export async function archiveVersion(
  runId: string,
  directory: string,
  includeRenders = true,
) {
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
      ...(includeRenders ? ["front.png", "rear.png", "detail.png"] : []),
      "metrics.json",
    ]) {
      await copyFile(resolve(DATA, directory, file), resolve(temporary, file));
    }
    // Agent -> platform handover: pure local processing before immutable publication.
    const original = await readFile(resolve(temporary, "asset.glb"));
    // Preserve existing structural validation before best-effort cleanup.
    const originalReceipt = handoverGlb(original).receipt;
    const cleaned = await cleanupGlb(original);
    const processed = handoverGlb(Buffer.from(cleaned.bytes));
    const receipt = {
      ...processed.receipt,
      cleanup: cleaned.cleanup,
      inputSha256: originalReceipt.inputSha256,
      inputBytes: original.length,
    };
    await writeFile(resolve(temporary, "asset.glb"), processed.bytes);
    await writeFile(
      resolve(temporary, "handover.json"),
      JSON.stringify(receipt),
    );
    const metrics = JSON.parse(
      await readFile(resolve(temporary, "metrics.json"), "utf8"),
    );
    await writeFile(
      resolve(temporary, "metrics.json"),
      JSON.stringify({
        ...metrics,
        triangles:
          "triangles" in cleaned.cleanup
            ? cleaned.cleanup.triangles.after
            : metrics.triangles,
        bytes: processed.bytes.length,
      }),
    );
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
  // Pre-upgrade archives remain immutable if a previously completed step replays.
  const handover = await readFile(
    resolve(DATA, destination, "handover.json"),
    "utf8",
  )
    .then((text) => JSON.parse(text))
    .catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
  const artifacts = {
    ...(handover
      ? { handover: { ...handover, manifest: `${destination}/handover.json` } }
      : {}),
    textures: JSON.parse(
      await readFile(resolve(DATA, destination, "textures.json"), "utf8").catch(
        () => "[]",
      ),
    ),
    glb: `${destination}/asset.glb`,
    blend: `${destination}/source.blend`,
    renders: includeRenders
      ? ["front", "rear", "detail"].map((v) => `${destination}/${v}.png`)
      : [],
    metrics: JSON.parse(
      await readFile(resolve(DATA, destination, "metrics.json"), "utf8"),
    ),
  };
  await publishFiles([
    ...(handover ? [`${destination}/handover.json`] : []),
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

/** Publish immutable photographs and attach them to the exact builder version. */
export async function archivePhotography(
  runId: string,
  builderRunId: string,
  directory: string,
  artifacts: Record<string, any>,
  requiredViews: readonly string[] = ["front", "rear", "detail"],
) {
  const { createHash } = await import("node:crypto");
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error("Photographer run not found");
  const saved = (run.result as any)?.photography;
  let photography = saved;
  if (!photography) {
    const receipt = JSON.parse(
      await readFile(resolve(DATA, directory, "photography.json"), "utf8"),
    );
    const hash = createHash("sha256")
      .update(await readFile(resolve(DATA, artifacts.glb)))
      .digest("hex");
    if (receipt.glbSha256 !== hash)
      throw new Error("Photographs do not match the exported GLB");
    const destination = `photographs/${runId}`;
    const temporary = resolve(
      DATA,
      `photographs/.${runId}-${crypto.randomUUID()}`,
    );
    await mkdir(temporary, { recursive: true });
    try {
      for (const view of requiredViews) {
        const png = await readFile(resolve(DATA, directory, `${view}.png`));
        if (
          png.length < 24 ||
          png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
          png.readUInt32BE(16) < 512 ||
          png.readUInt32BE(20) < 512
        )
          throw new Error(`Missing or invalid photograph: ${view}`);
        const digest = createHash("sha256").update(png).digest("hex");
        if (receipt.images?.[view] !== digest)
          throw new Error(`Stale photograph: ${view}`);
        await writeFile(resolve(temporary, `${view}.png`), png);
      }
      await writeFile(
        resolve(temporary, "photography.json"),
        JSON.stringify(receipt),
      );
      await rename(temporary, resolve(DATA, destination)).catch((error) => {
        if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    photography = {
      runId,
      builderRunId,
      glb: artifacts.glb,
      glbSha256: hash,
      renders: requiredViews.map((v) => `${destination}/${v}.png`),
      manifest: `${destination}/photography.json`,
    };
    await publishFiles([...photography.renders, photography.manifest]);
    await db
      .update(runs)
      .set({ result: { ...(run.result as object), photography } })
      .where(eq(runs.id, runId));
  }
  if (
    photography.builderRunId !== builderRunId ||
    photography.glb !== artifacts.glb
  )
    throw new Error("Photography belongs to a different build");
  const result = { ...artifacts, renders: photography.renders, photography };
  const [builder] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, builderRunId));
  await db
    .update(runs)
    .set({ result: { ...(builder.result as object), artifacts: result } })
    .where(eq(runs.id, builderRunId));
  return result;
}
