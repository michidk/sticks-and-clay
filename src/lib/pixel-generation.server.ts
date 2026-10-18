import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { runRole, roleInput } from "../modules/ai/index.server";
import type { AssetKind } from "./reviewed-asset.server";
import { getStorage, readStoredFile } from "./storage.server";
import { ZodError } from "zod";
import { checkpoint, jobContext } from "./checkpoint.server";
import {
  analyzePixels, enforcePalette, enlarged, MAX_FRAMES, MAX_LAYERS, MAX_PIXELS, PIXEL_FORMAT, PixelGridError,
  pixelGridSchema, resolvePixelAnswer, snapToPalette, validatePixelGrid, type PixelGrid,
} from "./pixel";
import { namedPalettes, palettePromptText } from "./pixel-palettes";
import { renderPixels } from "./pixel-render.server";
import { viewableReferences } from "./svg";

const blob = (data: Buffer | string, type: string) => new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type });
const REVIEW_LABEL = "the review sheet: the art zoomed with a cell grid (rows and columns numbered from 1, stronger lines every 8 cells), at 1x on dark and on light, 2x and 3x, its silhouette, its greyscale values, the colors drawn sorted dark to light with their palette keys, and the frames or layers when there are any";

/** The grid behind a saved pixel image, when one was stored beside it. */
async function savedGrid(imageKey: string) {
  try {
    return await (await readStoredFile(imageKey.replace(/[^/]+$/, "grid.json"))).text();
  } catch {
    return undefined;
  }
}

/** Stores a drawing's files and records the analysis on its run. Every file sits beside `pixel.png`, the asset. */
async function save(
  { grid, analysis, rendered, result, runId, directory }: {
    grid: PixelGrid; analysis: ReturnType<typeof analyzePixels>; rendered: Awaited<ReturnType<typeof renderPixels>>;
    result: object; runId: string; directory: string;
  },
) {
  const storage = getStorage();
  const key = `${directory}/pixel.png`;
  const review = `${directory}/review.png`;
  await storage.upload(blob(rendered.native, "image/png"), key);
  await storage.upload(blob(rendered.preview, "image/png"), `${directory}/preview.png`);
  await storage.upload(blob(rendered.review, "image/png"), review);
  await storage.upload(blob(JSON.stringify({ ...grid, plan: undefined, version: PIXEL_FORMAT }), "application/json"), `${directory}/grid.json`);
  const exports: Record<string, string> = {};
  for (const file of rendered.files) {
    exports[file.id] = `${directory}/${file.name}`;
    await storage.upload(blob(file.data, file.type), `${directory}/${file.name}`);
  }
  await db.update(runs).set({ result: { ...result, key, review, exports, pixelFormat: PIXEL_FORMAT, analysis } }).where(eq(runs.id, runId));
  return { key, previews: [{ key: review, label: REVIEW_LABEL }], analysis, exports };
}

/** Pixel art: the model draws on a grid (a palette and one string per row, optionally animation frames or paperdoll
 * layers) instead of generating an image, and the app renders it exactly. The reviewer sees a review sheet and
 * cell-level measurements; on a revision the drawer may patch rectangles of its previous drawing.
 */
export const pixelKind: AssetKind = {
  format: "pixel",
  judge: "pixel-judge",
  async build(ctx, { node, previous, feedback }) {
    const { model, batch } = ctx;
    const base = `graphics/${model.id}/${ctx.attempt}`;
    const directory = node.iteration ? `${base}/iteration-${node.iteration}` : base;
    const sources = (await Promise.all(ctx.references.filter((key) => key.endsWith("/pixel.png")).map(savedGrid))).filter(Boolean);
    const previousText = previous ? await savedGrid(previous.key) : undefined;
    const previousGrid = previousText ? (JSON.parse(previousText) as PixelGrid) : undefined;
    const shown = [
      ...(previous ? [{ key: previous.previews[0].key, note: `${previous.previews[0].label}, of the PREVIOUS ATTEMPT` }] : []),
      ...viewableReferences(ctx.references).map((key) => ({ key: enlarged(key), note: "style reference, not the artwork to copy" })),
    ];
    const palettes = namedPalettes(batch.design, ctx.request);
    const job = jobContext.getStore();
    if (!job) throw new Error("Missing durable job context");
    if (!job.checkpoint["pixel:palette-contract"])
      await checkpoint("pixel:palette-contract", Object.keys(job.checkpoint).some((key) => /^step:(pixel|builder:)/.test(key)) ? "1" : "3");
    const paletteContract = job.checkpoint["pixel:palette-contract"];
    // Models most often fail the strict row/column format or stray from a named palette, so such a drawing gets one
    // corrected retry with the problem named. A retry that still leaves the named palette is snapped to its nearest
    // colors and the substitution is recorded for the reviewer; any other second failure fails the version.
    let problem = "None";
    for (let attempt = 0; ; attempt++) {
      let runId: string | undefined;
      try {
        const answer = await runRole({
          role: "pixel",
          stepId: (node.iteration ? node.id : "pixel") + (attempt ? `:fix${attempt}` : ""),
          iteration: node.iteration,
          projectId: model.projectId,
          batchId: batch.id,
          modelId: model.id,
          input: await roleInput("pixel", {
            design: batch.design,
            name: model.name,
            request: ctx.request,
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
        let grid = resolvePixelAnswer(pixelGridSchema.parse(answer.result), previousGrid);
        let snapped: ReturnType<typeof snapToPalette>["snapped"] = [];
        validatePixelGrid(grid); // the cells first, so a malformed drawing is named before its colors
        if (paletteContract === "2") {
          const outside = analyzePixels(grid, palettes).colorsOutsideNamedPalette;
          if (outside?.length) throw new PixelGridError(`Palette keys ${outside.join(", ")} use colors outside the named palette; replace them with exact supplied hex values`);
        } else if (paletteContract !== "1") {
          if (attempt === 0) enforcePalette(grid, palettes);
          else ({ grid, snapped } = snapToPalette(grid, palettes));
        }
        const analysis = analyzePixels(grid, palettes, snapped);
        const rendered = await renderPixels(grid);
        return await save({ grid, analysis, rendered, result: answer.result, runId, directory });
      } catch (error) {
        if (runId) await db.update(runs).set({ status: "failed", error: String(error) }).where(eq(runs.id, runId));
        if (attempt || !(error instanceof PixelGridError || error instanceof ZodError)) throw error;
        problem = error instanceof ZodError
          ? `Your last answer did not match the required fields: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}. Return the whole drawing again.`
          : `Your last answer could not be drawn: ${(error as Error).message}. Count the cells of every row again and return the whole drawing, or valid patches against the previous drawing.`;
      }
    }
  },
};
