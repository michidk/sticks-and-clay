/** Three fixed briefs, no planner or repair variance. Run only against an isolated evaluation database. */
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, sql } from "../src/db/client";
import { projects, batches, assetEntries, assetVersions, jobs, runs } from "../src/db/schema";
import { DATA, getStorage } from "../src/lib/storage.server";
import { updateRuntimeSettings } from "../src/lib/runtime-settings.server";
import { jobContext } from "../src/lib/checkpoint.server";
import { executeAssetVersionJob } from "../src/lib/model-pipeline.server";
import { renderGraphicSheet } from "../src/lib/graphic-sheet.server";
import { failJob } from "../src/lib/pipeline.server";

const configSchema = z.object({
  subject: z.string().min(1), design: z.string().min(1), brief: z.string().min(1),
  references: z.array(z.object({ file: z.string(), note: z.string() })).min(1),
  alternatives: z.array(z.object({ name: z.string(), brief: z.string() })).length(3),
});
const configPath = process.argv[2];
const builder = z.enum(["gpt-6-sol", "gpt-6-astra"]).parse(process.argv[3]);
if (!configPath) throw new Error("Usage: bun scripts/explore-svg.ts CONFIG MODEL [--run]. Requires isolated STUDIO_DATA_DIR and DATABASE_URL with database name containing _eval_.");
const config = configSchema.parse(await Bun.file(configPath).json());
const execute = process.argv.includes("--run");
const database = new URL(process.env.DATABASE_URL || "postgres://localhost/missing");
if (!database.pathname.includes("_eval_") || !process.env.STUDIO_DATA_DIR || DATA === resolve("data") || (process.env.STORAGE_PROVIDER && process.env.STORAGE_PROVIDER !== "local"))
  throw new Error("Use an isolated _eval_ database, separate STUDIO_DATA_DIR and local storage. Never point an app worker at this database.");
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const references = await Promise.all(config.references.map(async (reference, index) => {
  const file = Bun.file(reference.file);
  const extension = reference.file.split(".").pop();
  if (!["svg", "png", "jpg", "webp"].includes(extension ?? "")) throw new Error("Unsupported reference file");
  return { ...reference, key: `references/${index}.${extension}`, sha256: hash(new Uint8Array(await file.arrayBuffer())) };
}));
const sources = ["scripts/explore-svg.ts", "prompts/svg/svg.md", "prompts/svg/svg-input.md", "prompts/references/svg-construction.md", "src/lib/svg-generation.server.ts", "src/lib/svg-render.server.ts"];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async (path) => [path, hash(await Bun.file(path).text())])));
const fingerprint = hash(JSON.stringify({ config, references, builder, sourceHashes }));
const manifestFile = Bun.file(resolve(DATA, "exploration.json"));
const manifestSchema = z.object({ fingerprint: z.string(), projectId: z.string().uuid(), batchId: z.string().uuid() });
const manifest = await manifestFile.exists()
  ? manifestSchema.parse(await manifestFile.json())
  : { fingerprint, projectId: crypto.randomUUID(), batchId: crypto.randomUUID() };
if (manifest.fingerprint !== fingerprint) throw new Error("Inputs changed. Choose a new data directory to preserve this experiment.");
console.log(JSON.stringify({ builder, subject: config.subject, candidates: config.alternatives, references, paidCalls: 3, reviewRounds: 0, data: DATA, execute }, null, 2));
if (!execute) { await sql.end(); process.exit(0); }
await Bun.write(manifestFile, JSON.stringify({ ...manifest, config, references, builder, sourceHashes }, null, 2));
await updateRuntimeSettings({ agents: { svg: { model: builder, effort: "high" } } });
for (const reference of references) await getStorage().upload(Bun.file(reference.file), reference.key);
const { projectId, batchId } = manifest;
if (!(await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId))).length) {
  await db.transaction(async (tx) => {
    await tx.insert(projects).values({ id: projectId, name: `${config.subject} exploration: ${builder}`, description: "Owner-requested isolated silhouette experiment. Human selection required before refinement.", assetType: "svg", status: "ready", design: config.design, designVersion: 1, references: references.map((r) => r.key) });
    await tx.insert(batches).values({ id: batchId, projectId, prompt: config.brief, count: 3, judgeIterations: 0, design: config.design, designVersion: 1, status: "building", workshop: { version: 0, variation: 0, effort: "standard", references: references.map((r) => r.key) } });
    for (const alternative of config.alternatives) {
      const assetId = crypto.randomUUID(), id = crypto.randomUUID();
      const prompt = `${config.brief}\n\nSilhouette exploration: ${alternative.brief}\n\nReference notes:\n${references.map((r) => `${r.key}: ${r.note}`).join("\n")}\n\nStop at the primary contour and recognition-critical openings. No decorative finish. The owner will choose which candidate to refine.`;
      await tx.insert(assetEntries).values({ id: assetId, projectId, title: alternative.name, batchId, inIdea: false, input: { prompt, count: 1, judgeIterations: 0, imageSize: "1024x1024" } });
      await tx.insert(assetVersions).values({ id, assetId, projectId, batchId, name: alternative.name, prompt });
      await tx.insert(jobs).values({ id: crypto.randomUUID(), kind: "model", targetId: id });
    }
  });
}
// Process only this experiment's jobs. No shared worker or global settings are changed.
const versions = await db.select().from(assetVersions).where(eq(assetVersions.batchId, batchId));
for (const version of versions) {
  const [job] = await db.select().from(jobs).where(eq(jobs.targetId, version.id));
  if (!job || job.status === "done" || job.status === "failed") continue;
  await db.update(jobs).set({ status: "running", startedAt: new Date() }).where(eq(jobs.id, job.id));
  try {
    await jobContext.run({ id: job.id, checkpoint: job.checkpoint ?? {} }, () => executeAssetVersionJob(version.id));
    await db.update(jobs).set({ status: "done", finishedAt: new Date() }).where(eq(jobs.id, job.id));
    console.log("Completed", builder, version.name);
  } catch (error) {
    await failJob(job.kind, job.targetId, String(error));
    await db.update(jobs).set({ status: "failed", error: String(error), finishedAt: new Date() }).where(eq(jobs.id, job.id));
    console.error("Failed", builder, version.name, String(error));
  }
}
const [sheetJob] = await db.select().from(jobs).where(eq(jobs.targetId, batchId));
if (sheetJob && sheetJob.status !== "done" && sheetJob.status !== "failed") {
  await db.update(jobs).set({ status: "running", startedAt: new Date() }).where(eq(jobs.id, sheetJob.id));
  await jobContext.run({ id: sheetJob.id, checkpoint: sheetJob.checkpoint ?? {} }, () => renderGraphicSheet(batchId));
  await db.update(jobs).set({ status: "done", finishedAt: new Date() }).where(eq(jobs.id, sheetJob.id));
}
const results = { builder, projectId, batchId, versions: await db.select().from(assetVersions).where(eq(assetVersions.batchId, batchId)), runs: await db.select().from(runs).where(eq(runs.batchId, batchId)) };
await Bun.write(resolve(DATA, "results.json"), JSON.stringify(results, null, 2));
console.log("Estimated cost", results.runs.reduce((sum, run) => sum + (run.estimatedCost ?? 0), 0));
await sql.end();
if (results.versions.some((version) => version.status !== "done")) process.exitCode = 1;
