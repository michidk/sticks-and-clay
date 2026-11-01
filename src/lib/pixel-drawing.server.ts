import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { getStorage } from "./storage.server";
import { PIXEL_FORMAT, type PixelGrid, analyzePixels } from "./pixel";
import { renderPixels } from "./pixel-render.server";
const blob = (data: Buffer | string, type: string) => new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type });
export const REVIEW_LABEL = "the review sheet: the art zoomed with a cell grid (rows and columns numbered from 1, stronger lines every 8 cells), at 1x on dark and on light, 2x and 3x, its silhouette, its greyscale values, the colors drawn sorted dark to light with their palette keys, the frames or layers when there are any, and a 3x3 repetition panel for tiles or modular segments";

/** Stores a drawing's files and records the analysis on its run. Every file sits beside `pixel.png`, the asset. */
export async function savePixelDrawing(
  { grid, analysis, rendered, result, runId, directory, construction, recordRun = true }: {
    grid: PixelGrid; analysis: ReturnType<typeof analyzePixels>; rendered: Awaited<ReturnType<typeof renderPixels>>;
    result: object; runId: string; directory: string; construction?: string; recordRun?: boolean;
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
  if (recordRun) await db.update(runs).set({ result: { ...result, ...(construction ? { construction, constructionKey: key } : { key }), review, exports, pixelFormat: PIXEL_FORMAT, analysis } }).where(eq(runs.id, runId));
  return { runId, key, previews: [{ key: review, label: REVIEW_LABEL }], analysis, exports };
}
