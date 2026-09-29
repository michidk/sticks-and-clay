import { eq } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../db/client";
import { batches, models } from "../db/schema";
import { DATA, filePath } from "./storage.server";
export async function renderCollection(batchId: string) {
  const assets = await db
    .select()
    .from(models)
    .where(eq(models.batchId, batchId));
  const ready = assets.filter((m) => m.status === "done" && m.artifacts);
  if (!ready.length) throw new Error("No completed assets to render");
  const directory = `collections/${batchId}/${crypto.randomUUID()}`,
    output = resolve(DATA, directory);
  await mkdir(output, { recursive: true });
  const config = {
    output,
    assets: await Promise.all(
      ready.map(async (m) => ({
        name: m.name,
        path: await filePath(String(m.artifacts!.glb)),
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
    await db
      .update(batches)
      .set({
        status: assets.some((m) => m.status === "failed")
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
  }
}
