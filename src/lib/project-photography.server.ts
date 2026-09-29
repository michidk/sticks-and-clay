import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../db/client";
import { models, projects, runs } from "../db/schema";
import { DATA, publishFiles, readStoredFile } from "./storage.server";
import { checkpoint, jobContext } from "./checkpoint.server";
import { assertJobActive } from "./queue.server";
import { roleInput, runRole } from "../modules/ai/index.server";

export async function projectPhotographs(projectId?: string) {
  const photos = await db
    .select({
      projectId: runs.projectId,
      result: runs.result,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .where(
      and(
        eq(runs.role, "photographer"),
        eq(runs.status, "done"),
        ...(projectId ? [eq(runs.projectId, projectId)] : []),
      ),
    )
    .orderBy(desc(runs.finishedAt), desc(runs.createdAt));
  return photos.flatMap((run) => {
    const photo = (run.result as any)?.projectPhotography;
    return photo
      ? [{ ...photo, projectId: run.projectId, finishedAt: run.finishedAt }]
      : [];
  });
}

export async function photographProject(projectId: string) {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  if (!job.checkpoint["project-photo-input"]) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) throw new Error("Project not found");
    const assets = (
      await db.select().from(models).where(eq(models.projectId, projectId))
    )
      .filter((m) => m.artifacts?.glb)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({
        modelId: m.id,
        name: m.name,
        glb: String(m.artifacts!.glb),
        stage: m.artifacts!.stage,
      }));
    if (!assets.length) return;
    // Older builds predate immutable version archives. Freeze their actual bytes
    // so later retries cannot silently photograph a changed workspace export.
    const frozen = await Promise.all(
      assets.map(async (asset) => {
        if (asset.glb.startsWith("versions/"))
          return { ...asset, renderGlb: asset.glb };
        const bytes = Buffer.from(
          await (await readStoredFile(asset.glb)).arrayBuffer(),
        );
        const hash = createHash("sha256").update(bytes).digest("hex");
        const folder = `versions/project-snapshot-${hash}`;
        const renderGlb = `${folder}/asset.glb`;
        await mkdir(resolve(DATA, folder), { recursive: true });
        const temporary = resolve(DATA, folder, `${crypto.randomUUID()}.tmp`);
        try {
          await writeFile(temporary, bytes);
          await rename(temporary, resolve(DATA, renderGlb));
        } finally {
          await rm(temporary, { force: true });
        }
        await publishFiles([renderGlb]);
        return { ...asset, renderGlb };
      }),
    );
    await checkpoint(
      "project-photo-input",
      JSON.stringify({
        name: project.name,
        design: project.design,
        assets: frozen,
        references: project.references,
      }),
    );
  }
  const input = JSON.parse(job.checkpoint["project-photo-input"]);
  const directory = `project-photographs/${projectId}/${job.id}`;
  const capability =
    job.checkpoint["capability:project-photo"] || crypto.randomUUID();
  if (!job.checkpoint["capability:project-photo"])
    await checkpoint("capability:project-photo", capability);
  await mkdir(resolve(DATA, directory), { recursive: true });
  await mkdir(resolve(DATA, "capabilities"), { recursive: true });
  await writeFile(
    resolve(DATA, "capabilities", capability + ".json"),
    JSON.stringify({
      role: "photographer",
      directory,
      assets: input.assets.map((a: any) => a.renderGlb || a.glb),
    }),
  );
  const { runId } = await runRole({
    role: "photographer",
    projectId,
    images: input.references || [],
    input: await roleInput("photographer", {
      name: input.name,
      request:
        "Project collection thumbnail: photograph ALL supplied exports together. This front view will be the project cover.",
      design: input.design,
      stage: "project collection",
      capability,
      glb: input.assets
        .map((a: any) => `${a.name}: ${a.glb} (${a.stage || "complete"})`)
        .join("\n"),
      directory: resolve(DATA, directory),
      metrics: JSON.stringify({ models: input.assets.length }),
    }),
  });
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if ((run.result as any)?.projectPhotography) return;
  try {
    const receipt = JSON.parse(
      await readFile(resolve(DATA, directory, "photography.json"), "utf8"),
    );
    for (const asset of input.assets) {
      const path = resolve(DATA, asset.renderGlb || asset.glb);
      if (
        receipt.assets?.[path] !==
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex")
      )
        throw new Error("Project photo does not match the asset snapshot");
    }
    const renders = ["front", "rear", "detail"].map(
      (v) => `${directory}/${v}.png`,
    );
    for (const [index, key] of renders.entries()) {
      const png = await readFile(resolve(DATA, key));
      if (
        png.length < 24 ||
        png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        png.readUInt32BE(16) < 512 ||
        png.readUInt32BE(20) < 512 ||
        receipt.images?.[["front", "rear", "detail"][index]] !==
          createHash("sha256").update(png).digest("hex")
      )
        throw new Error("Invalid project photograph");
    }
    await assertJobActive();
    await publishFiles([...renders, `${directory}/photography.json`]);
    // Publish last, so failed/partial photographs never replace a working cover.
    await db
      .update(runs)
      .set({
        result: {
          ...(run.result as object),
          projectPhotography: {
            runId,
            thumbnail: renders[0],
            renders,
            assets: input.assets,
            manifest: `${directory}/photography.json`,
          },
        },
        finishedAt: new Date(),
      })
      .where(eq(runs.id, runId));
  } catch (error) {
    await db
      .update(runs)
      .set({ status: "failed", error: "Artifact validation: " + String(error) })
      .where(eq(runs.id, runId));
    throw error;
  }
}
