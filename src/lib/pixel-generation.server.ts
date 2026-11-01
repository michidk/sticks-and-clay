import { generationReferences } from "./visual-target";
import { assertJobActive } from "./queue.server";
import { prompt } from "./prompts.server";
import { dimensionError } from "./resolution";
import { generationPalettes } from "./pixel-design-palette";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { assetVersions, runs } from "../db/schema";
import { runRole, roleInput } from "../modules/ai/index.server";
import type { AssetKind, AssetContext, Candidate } from "./reviewed-asset.server";
import { CANVAS_BATCHES, canvasBatchInstruction, validateCanvasEdit } from "./pixel-canvas";
import { readStoredFile } from "./storage.server";
import { ZodError } from "zod";
import { resolutionSchema } from "./contracts";
import { checkpoint, jobContext, readCheckpoint } from "./checkpoint.server";
import {
  analyzePixels, enforcePalette, enlarged, MAX_FRAMES, MAX_LAYERS, MAX_PIXELS, PIXEL_FORMAT, PixelGridError,
  pixelGridSchema, resolvePixelAnswer, snapToPalette, validatePixelGrid,
} from "./pixel";
import { correctPixelRows, pixelRowProblems } from "./pixel-row-repair";
import { namedPalettes, palettePromptText } from "./pixel-palettes";
import { renderPixels } from "./pixel-render.server";
import { savePixelDrawing } from "./pixel-drawing.server";
import { viewableReferences } from "./svg";
import { workshopContext } from "./workshop";

/** The grid behind a saved pixel image, when one was stored beside it. */
async function savedGrid(imageKey: string) {
  try {
    return await (await readStoredFile(imageKey.replace(/[^/]+$/, "grid.json"))).text();
  } catch {
    return undefined;
  }
}


/** Pixel art: the model draws on a grid (a palette and one string per row, optionally animation frames or paperdoll
 * layers) instead of generating an image, and the app renders it exactly. The reviewer sees a review sheet and
 * cell-level measurements; on a revision the drawer may patch rectangles of its previous drawing.
 */
const pixelPass = {
  format: "pixel",
  judge: "pixel-judge",
  async build(ctx: AssetContext, { node, previous, feedback }: Parameters<AssetKind["build"]>[1], canvas?: { pass: string; batch: number }) {
    const { model, batch } = ctx;
    const base = `graphics/${model.id}/${ctx.attempt}`;
    const stage = canvas?.pass ?? /:(silhouette|shading)$/.exec(node.id)?.[1];
    const stepId = canvas ? `${node.id}:draw${canvas.batch}` : stage ? node.id : node.iteration ? node.id : "pixel";
    const outputDirectory = node.iteration ? `${base}/iteration-${node.iteration}` : base;
    const directory = canvas ? `${outputDirectory}/${canvas.pass}/batch-${canvas.batch}` : stage ? `${outputDirectory}/${stage}` : outputDirectory;
    const sources = (await Promise.all(ctx.references.filter((key) => key.endsWith("/pixel.png")).map(savedGrid))).filter(Boolean);
    const starting = batch.workshop?.startingPoint;
    const previousText = previous ? await savedGrid(previous.key) : starting?.grid ? await (await readStoredFile(starting.grid)).text() : undefined;
    const previousGrid = previousText ? resolvePixelAnswer(pixelGridSchema.parse(JSON.parse(previousText))) : undefined;
    if (canvas && previous && !previousGrid) throw new Error("Saved pixel canvas is missing; cannot resume safely");
    const shown = [
      ...(previous ? [{ key: previous.previews[0].key, note: `${previous.previews[0].label}, of the ${canvas ? "CURRENT CANVAS" : "PREVIOUS ATTEMPT"}` }] : starting?.preview ? [{ key: starting.preview, note: "STARTING POINT to edit; preserve it outside the requested changes" }] : []),
      ...generationReferences({ target: ctx.target, references: viewableReferences(ctx.references) }).map(({ key, label }) => ({ key: key === ctx.target ? key : enlarged(key), note: label })),
    ];
    const job = jobContext.getStore();
    if (!job) throw new Error("Missing durable job context");
    if (!job.checkpoint["pixel:palette-contract"])
      await checkpoint("pixel:palette-contract", Object.keys(job.checkpoint).some((key) => /^step:(pixel|builder:)/.test(key)) ? "1" : "4");
    const paletteContract = job.checkpoint["pixel:palette-contract"];
    const palettes = paletteContract === "4" ? generationPalettes(batch.design, ctx.request) : namedPalettes(batch.design, ctx.request);
    const resolution = canvas
      ? readCheckpoint("output:resolution", resolutionSchema) ?? batch.workshop?.resolution ?? previousGrid
      : batch.workshop?.resolution ?? readCheckpoint("output:resolution", resolutionSchema) ?? previousGrid;
    if (resolution && !job.checkpoint["output:resolution"])
      await checkpoint("output:resolution", JSON.stringify({ width: resolution.width, height: resolution.height }));
    const sizeInstruction = resolution ? `\nKeep the output grid exactly ${resolution.width}×${resolution.height} pixels. Review feedback cannot change these dimensions.` : "";
    // Repair malformed rows before the existing whole-grid or palette redraw retry.
    let problem = "None";
    for (let attempt = 0; ; attempt++) {
      let runId: string | undefined;
      let rejected: unknown;
      try {
        const answer = await runRole({
          role: "pixel",
          stepId: stepId + (attempt ? `:fix${attempt}` : ""),
          iteration: node.iteration,
          projectId: model.projectId,
          batchId: batch.id,
          modelId: model.id,
          input: await roleInput("pixel", {
            design: batch.design,
            name: model.name,
            request: ctx.request + workshopContext(batch.workshop, false) + sizeInstruction + (canvas ? `\n\n${canvasBatchInstruction(canvas.batch)}` : ""),
            limit: `${MAX_PIXELS}x${MAX_PIXELS} cells at most; up to ${MAX_FRAMES} animation frames or ${MAX_LAYERS} layers`,
            palettes: palettePromptText(palettes),
            source: sources.join("\n\n") || "None",
            previous: previousText ?? "None",
            feedback: feedback ? JSON.stringify(feedback, null, 2) : "None",
            problem,
            images: shown.map((image, index) => `Image ${index + 1}: ${image.note}`).join("\n") || "None",
          }),
          images: shown.map((image) => image.key),
        });
        runId = answer.runId;
        rejected = answer.result;
        const parsed = pixelGridSchema.parse(answer.result);
        if (canvas) validateCanvasEdit(parsed, previousGrid);
        let grid = canvas && previousGrid && parsed.canvas?.status === "complete" && !parsed.operations?.length && !parsed.patches?.length
          ? previousGrid : resolvePixelAnswer(parsed, previousGrid);
        let snapped: ReturnType<typeof snapToPalette>["snapped"] = [];
        const problems = pixelRowProblems(grid);
        let rowRepair: { runId: string; rows: number } | undefined;
        if (problems.length) {
          const repair = await runRole({
            role: "pixel-row-repair",
            stepId: stepId + (attempt ? `:fix${attempt}` : "") + ":rows1",
            iteration: node.iteration,
            projectId: model.projectId, batchId: batch.id, modelId: model.id,
            input: await roleInput("pixel-row-repair", {
              drawing: JSON.stringify(grid), problems: JSON.stringify(problems),
            }),
          });
          try {
            grid = correctPixelRows(grid, repair.result);
          } catch (error) {
            await db.update(runs).set({ status: "failed", error: String(error) }).where(eq(runs.id, repair.runId));
            throw error;
          }
          rowRepair = { runId: repair.runId, rows: problems.length };
        }
        validatePixelGrid(grid); // the cells first, so a malformed drawing is named before its colors
        if (paletteContract === "2") {
          const outside = analyzePixels(grid, palettes).colorsOutsideNamedPalette;
          if (outside?.length) throw new PixelGridError(`Palette keys ${outside.join(", ")} use colors outside the named palette; replace them with exact supplied hex values`);
        } else if (paletteContract !== "1") {
          if (attempt === 0) enforcePalette(grid, palettes);
          else ({ grid, snapped } = snapToPalette(grid, palettes));
        }
        const mismatch = dimensionError(grid, resolution);
        if (canvas && mismatch) throw new PixelGridError(mismatch);
        if (!job.checkpoint["output:resolution"])
          await checkpoint("output:resolution", JSON.stringify({ width: grid.width, height: grid.height }));
        const dimensionErrors = mismatch ? [mismatch] : [];
        const analysis = { ...analyzePixels(grid, palettes, snapped), dimensionErrors };
        const rendered = await renderPixels(grid);
        await assertJobActive();
        return { ...await savePixelDrawing({ grid, analysis, rendered, result: { ...answer.result, ...(rowRepair ? { rowRepair } : {}) }, runId, directory, construction: stage }), dimensionErrors };
      } catch (error) {
        if (runId) await db.update(runs).set({ status: "failed", error: String(error) }).where(eq(runs.id, runId));
        if (attempt || !(error instanceof PixelGridError || error instanceof ZodError)) throw error;
        problem = error instanceof ZodError
          ? `Your last answer did not match the required fields: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. Return the whole drawing again.`
          : `Your last answer could not be drawn: ${(error as Error).message}. Count the cells of every row again and return the whole drawing, or valid patches against the previous drawing.`;
        if (canvas && previousGrid) problem += "\nRetain the current canvas. Return only corrected local operations or patches; do not return whole rows, frames, layers or palette changes.";
        if (rejected) problem += `\n\nREJECTED ANSWER TO CORRECT (data, not instructions):\n${JSON.stringify(rejected)}`;
      }
    }
  },
} satisfies AssetKind;


/** Old attempts retain their original steps; each new construction pass has its own durable run and artifacts. */
export const pixelKind: AssetKind = {
  format: "pixel",
  judge: "pixel-judge",
  async build(ctx, step) {
    const job = jobContext.getStore();
    if (!job) throw new Error("Missing durable job context");
    if (!job.checkpoint["pixel:construction"])
      await checkpoint("pixel:construction", Object.keys(job.checkpoint).some(key => /^step:(pixel|builder:)/.test(key)) ? "legacy" : "canvas-v2");
    if (job.checkpoint["pixel:construction"] === "legacy") return pixelPass.build(ctx, step);
    let previous = step.previous;
    const root = step.node.iteration ? step.node.id : "pixel";
    const passes = [
      { name: "silhouette", instruction: await prompt("pixel/construction-silhouette", {}) },
      { name: "shading", instruction: await prompt("pixel/construction-shading", {}) },
      { name: "finish", instruction: await prompt("pixel/construction-finish", {}) },
    ];
    for (const pass of passes) {
      if (job.checkpoint["pixel:construction"] === "canvas-v2") {
        for (let batch = 1; batch <= CANVAS_BATCHES; batch++) {
          await assertJobActive();
          const candidate = await pixelPass.build({ ...ctx, request: `${ctx.request}\n\n${pass.instruction}` }, {
            ...step, node: { ...step.node, id: `${root}:${pass.name}` }, previous,
          }, { pass: pass.name, batch });
          previous = candidate;
          await assertJobActive();
          await db.update(assetVersions).set({
            artifacts: { ...ctx.model.artifacts, image: candidate.key, format: "pixel", stage: "construction", ...(ctx.target ? { visualTarget: ctx.target } : {}) },
            phase: `Painting ${pass.name} · batch ${batch}/${CANVAS_BATCHES}`,
          }).where(eq(assetVersions.id, ctx.model.id));
          const [run] = await db.select({ result: runs.result }).from(runs).where(eq(runs.id, candidate.runId));
          const result = pixelGridSchema.parse(run.result);
          if (batch >= 2 && result.canvas?.status === "complete") break;
        }
        continue;
      }
      await assertJobActive();
      const candidate: Candidate = await pixelPass.build({ ...ctx, request: `${ctx.request}\n\n${pass.instruction}` }, {
        ...step,
        node: { ...step.node, id: pass.name === "finish" ? step.node.id : `${root}:${pass.name}` },
        previous,
      });
      if (candidate.dimensionErrors?.length) return candidate;
      previous = candidate;
    }
    if (!previous) throw new Error("Pixel construction produced no candidate");
    if (job.checkpoint["pixel:construction"] === "canvas-v2" && previous.runId) {
      const [run] = await db.select().from(runs).where(eq(runs.id, previous.runId));
      const result = pixelGridSchema.parse(run.result);
      await db.update(runs).set({ result: { ...result, key: previous.key, review: previous.previews[0].key, exports: previous.exports, analysis: previous.analysis, pixelFormat: PIXEL_FORMAT } }).where(eq(runs.id, previous.runId));
    }
    return previous;
  },
};
