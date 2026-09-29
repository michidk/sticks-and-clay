import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { DATA } from "./storage.server";

export async function archiveVersion(runId: string, directory: string) {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) throw new Error("Builder run not found");
  const result = run.result as Record<string, any>;
  if (result?.artifacts) return result.artifacts;
  const destination = `versions/${runId}`;
  const temporary = resolve(DATA, `versions/.${runId}-${crypto.randomUUID()}`);
  await mkdir(temporary, { recursive: true });
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
    await rename(temporary, resolve(DATA, destination)).catch(async (error) => {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const artifacts = {
    glb: `${destination}/asset.glb`,
    blend: `${destination}/source.blend`,
    renders: ["front", "rear", "detail"].map((v) => `${destination}/${v}.png`),
    metrics: JSON.parse(
      await readFile(resolve(DATA, destination, "metrics.json"), "utf8"),
    ),
  };
  await db
    .update(runs)
    .set({ result: { ...result, artifacts } })
    .where(eq(runs.id, runId));
  return artifacts;
}
