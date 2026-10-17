import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { runRole, roleInput } from "../modules/ai/index.server";
import type { AssetKind } from "./reviewed-asset.server";
import { getStorage, readStoredFile } from "./storage.server";
import { analyzePixels, MAX_PIXELS, pixelGridSchema, type PixelGrid } from "./pixel";
import { renderPixels } from "./pixel-render.server";
import { viewableReferences } from "./svg";

const blob = (data: Buffer | string, type: string) => new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type });

/** The grid behind a saved pixel image, when one was stored beside it. */
async function savedGrid(imageKey: string) {
  try {
    return await (await readStoredFile(imageKey.replace(/[^/]+$/, "grid.json"))).text();
  } catch {
    return undefined;
  }
}

/** Pixel art: the model draws on a grid (a palette and one string per row) instead of generating an image,
 * and the app renders it exactly. The reviewer sees an enlarged render and cell-level measurements.
 */
export const pixelKind: AssetKind = {
  format: "pixel",
  judge: "pixel-judge",
  async build(ctx, { node, previous, feedback }) {
    const { model, batch } = ctx;
    const base = `graphics/${model.id}/${ctx.attempt}`;
    const directory = node.iteration ? `${base}/iteration-${node.iteration}` : base;
    const sources = (await Promise.all(ctx.references.filter((key) => key.endsWith("/pixel.png")).map(savedGrid))).filter(Boolean);
    const shown = [
      ...(previous ? [{ key: previous.previews[0].key, note: "enlarged render of the PREVIOUS ATTEMPT, on white" }] : []),
      ...viewableReferences(ctx.references).map((key) => ({ key, note: "style reference, not the artwork to copy" })),
    ];
    const { result, runId } = await runRole({
      role: "pixel",
      stepId: node.iteration ? node.id : "pixel",
      iteration: node.iteration,
      projectId: model.projectId,
      batchId: batch.id,
      modelId: model.id,
      input: await roleInput("pixel", {
        design: batch.design,
        name: model.name,
        request: ctx.request,
        limit: `${MAX_PIXELS}x${MAX_PIXELS} cells at most`,
        source: sources.join("\n\n") || "None",
        previous: previous ? (await savedGrid(previous.key)) ?? "None" : "None",
        feedback: feedback ? JSON.stringify(feedback, null, 2) : "None",
        images: shown.map((image, index) => `Image ${index + 1}: ${image.note}`).join("\n") || "None",
      }),
      images: shown.map((image) => image.key),
    });
    let grid: PixelGrid, rendered: Awaited<ReturnType<typeof renderPixels>>, analysis: ReturnType<typeof analyzePixels>;
    try {
      grid = pixelGridSchema.parse(result);
      analysis = analyzePixels(grid);
      rendered = await renderPixels(grid);
    } catch (error) {
      await db.update(runs).set({ status: "failed", error: String(error) }).where(eq(runs.id, runId));
      throw error;
    }
    const storage = getStorage();
    const key = `${directory}/pixel.png`;
    const preview = `${directory}/preview.png`;
    await storage.upload(blob(rendered.native, "image/png"), key);
    await storage.upload(blob(rendered.preview, "image/png"), preview);
    await storage.upload(blob(JSON.stringify({ ...grid, plan: undefined }), "application/json"), `${directory}/grid.json`);
    await db.update(runs).set({ result: { ...result, key, analysis } }).where(eq(runs.id, runId));
    return {
      key,
      previews: [{ key: preview, label: `the art enlarged ${rendered.scale}x on white, each square one cell` }],
      analysis,
    };
  },
};
