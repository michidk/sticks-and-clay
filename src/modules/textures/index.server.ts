import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { jobs, runs } from "../../db/schema";
import { DATA } from "../../lib/storage.server";

import { runImageRole } from "../ai/index.server";

export const textureRequest = z.object({
  capability: z.string().uuid(),
  name: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  prompt: z.string().min(20).max(8000),
});
const active = new Map<string, Promise<unknown>>();
export async function generateTexture(args: z.infer<typeof textureRequest>) {
  const key = JSON.stringify(args);
  const existing = active.get(key);
  if (existing) return existing;
  const work = createTexture(args).finally(() => active.delete(key));
  active.set(key, work);
  return work;
}
async function createTexture(args: z.infer<typeof textureRequest>) {
  const marker = resolve(DATA, "capabilities", args.capability + ".json");
  const authorization = JSON.parse(await readFile(marker, "utf8"));
  if (authorization.cancelled) throw new Error("Build cancelled");
  const match = /^models\/([^/]+)\/([^/]+)\/iteration-(\d+)$/.exec(
    authorization.directory,
  );
  if (!match) throw new Error("Unsupported builder workspace");
  const [, modelId, attempt, iteration] = match;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, attempt));
  if (!job || job.status !== "running")
    throw new Error("Builder job is not running");
  const builderId = job.checkpoint[`agent:builder:${iteration}`];
  const [builder] = builderId
    ? await db.select().from(runs).where(eq(runs.id, builderId))
    : [];
  if (!builder || builder.role !== "builder" || builder.modelId !== modelId)
    throw new Error("Missing authorized builder run");
  return runImageRole({
    role: "texture",
    name: args.name,
    prompt: args.prompt,
    directory: `${authorization.directory}/textures`,
    projectId: builder.projectId,
    batchId: builder.batchId,
    modelId,
    iteration: Number(iteration),
    assertActive: async () => {
      if (JSON.parse(await readFile(marker, "utf8")).cancelled)
        throw new Error("Build cancelled");
      const [current] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, attempt));
      if (current?.status !== "running")
        throw new Error("Build no longer running");
    },
  });
}
