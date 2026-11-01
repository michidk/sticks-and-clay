import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { assetVersions, projects, runs } from "../db/schema";
import { readStoredFile, getStorage } from "./storage.server";
import { pixelGridSchema, resolvePixelAnswer, analyzePixels, validatePixelGrid } from "./pixel";
import { pixelEditInput, editPixelCanvas } from "./pixel-edit";
import { renderPixels } from "./pixel-render.server";
import { savePixelDrawing } from "./pixel-drawing.server";
import { assertNotArchived } from "./project-lifecycle.server";
import { z } from "zod";

async function sourceCanvas(versionId: string, runId: string) {
  const [source] = await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.modelId, versionId)));
  const saved = z.object({ key: z.string() }).safeParse(source?.result);
  if (!source || source.role !== "pixel" || source.status !== "done" || !saved.success)
    throw new Error("Choose a completed pixel drawing");
  const [version] = await db.select().from(assetVersions).where(eq(assetVersions.id, versionId));
  if (!version) throw new Error("Version not found");
  const [project] = await db.select().from(projects).where(eq(projects.id, version.projectId));
  if (!project || project.assetType !== "pixel") throw new Error("Pixel project required");
  const key = saved.data.key.replace(/[^/]+$/, "grid.json");
  const grid = resolvePixelAnswer(pixelGridSchema.parse(JSON.parse(await (await readStoredFile(key)).text())));
  validatePixelGrid(grid);
  return { grid, source, version, project };
}

export async function getEditablePixels(versionId: string, runId: string) {
  return (await sourceCanvas(versionId, runId)).grid;
}

/** Manual edits create a separate, unaccepted version. Source bytes and AI accounting stay intact. */
export async function savePixelEdits(versionId: string, input: z.infer<typeof pixelEditInput>) {
  const { grid: before, source, version, project } = await sourceCanvas(versionId, input.sourceRunId);
  assertNotArchived(project);
  if (!["done", "failed", "cancelled"].includes(version.status)) throw new Error("Wait for generation to finish before editing");
  const grid = editPixelCanvas(before, input.edits);
  const rendered = await renderPixels(grid);
  const id = crypto.randomUUID(), runId = crypto.randomUUID();
  const directory = `graphics/${id}/manual`;
  try {
    // Store immutable bytes before publishing the new version in the database.
    const candidate = await savePixelDrawing({ grid, analysis: analyzePixels(grid), rendered, result: grid, runId, directory, recordRun: false });
    await db.transaction(async tx => {
      const [owner] = await tx.select().from(projects).where(eq(projects.id, project.id)).for("update");
      assertNotArchived(owner);
      await tx.insert(assetVersions).values({
        id, assetId: version.assetId, projectId: project.id, batchId: version.batchId,
        name: version.name, prompt: version.prompt, parentModelId: version.id, sourceRunId: source.id,
        branchKind: "iterate", changePrompt: "Manual pixel edits", status: "done", progress: 100,
        phase: "Manual edit · awaiting review", verdict: "manual", acceptedAt: null,
        artifacts: { image: candidate.key, format: "pixel", stage: "final", exports: candidate.exports, ...(version.artifacts?.visualTarget ? { visualTarget: version.artifacts.visualTarget } : {}) },
      });
      await tx.insert(runs).values({
        id: runId, projectId: project.id, batchId: version.batchId, modelId: id,
        role: "pixel", engine: "tanstack", model: "manual", status: "done", promptVersion: "manual-v1",
        systemPrompt: "Owner pixel edit; no AI request", input: JSON.stringify(input), output: "Manual pixel edits",
        result: { ...grid, key: candidate.key, review: candidate.previews[0].key, analysis: candidate.analysis, exports: candidate.exports, manual: true },
        usageSource: "not_started", estimatedCost: 0, rates: { input: 0, output: 0, cached: 0, source: "manual" }, finishedAt: new Date(),
      });
    });
    return { id, runId };
  } catch (error) {
    for (const key of await getStorage().list(directory)) await getStorage().delete(key);
    throw error;
  }
}
