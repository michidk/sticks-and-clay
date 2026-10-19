import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { runRole, roleInput } from "../modules/ai/index.server";
import type { AssetKind } from "./reviewed-asset.server";
import { getStorage, readStoredFile } from "./storage.server";
import { analyzeSvg, validateSvg, viewableReferences } from "./svg";
import { renderSvg } from "./svg-render.server";
import { workshopContext } from "./workshop";

const png = (data: Buffer) => new Blob([new Uint8Array(data)], { type: "image/png" });

/** The images shown to the SVG model, with a line telling it what each one is. Renders come first,
 * so the model sees what the earlier markup actually looks like instead of reading code alone. */
export async function attachedImages(previousRender: string | undefined, sourceRenders: string[], references: string[]) {
  // Restored versions can carry their SVG source as the fallback preview.
  if (previousRender?.endsWith(".svg")) previousRender = await renderOf(previousRender);
  const entries = [
    ...(previousRender ? [{ key: previousRender, note: "render of the PREVIOUS ATTEMPT SVG, on white" }] : []),
    ...sourceRenders.map((key) => ({ key, note: "render of the SAVED SOURCE SVG, on white" })),
    ...viewableReferences(references).map((key) => ({ key, note: "style reference, not the artwork to copy" })),
  ];
  return {
    keys: entries.map((entry) => entry.key),
    notes: entries.map((entry, index) => `Image ${index + 1}: ${entry.note}`).join("\n") || "None",
  };
}

/** A PNG render saved beside an SVG, made now for sources that have none. */
async function renderOf(svgKey: string) {
  const key = svgKey.replace(/[^/]+$/, "preview.png");
  const storage = getStorage();
  if (!(await storage.exists(key)))
    await storage.upload(png((await renderSvg(await (await readStoredFile(svgKey)).text())).full), key);
  return key;
}

/** SVG: the model writes markup; the "workshop" is a sanitizer plus a rasterizer, so the
 * judge reviews pixels and measurements of the actual artwork.
 */
export const svgKind: AssetKind = {
  format: "svg",
  judge: "svg-judge",
  async build(ctx, { node, previous, feedback }) {
    const { model, batch } = ctx;
    // Iteration 0 keeps the one-shot layout so jobs saved before review rounds resume unchanged.
    const base = `graphics/${model.id}/${ctx.attempt}`;
    const directory = node.iteration ? `${base}/iteration-${node.iteration}` : base;
    const starting = batch.workshop?.startingPoint;
    const sourceKeys = [...(starting?.format === "svg" ? [starting.key.replace(/source\.svg$/, "editable.svg")] : []), ...ctx.references.filter((key) => key.endsWith(".svg"))];
    const source = await Promise.all(sourceKeys.map(async (key) => (await readStoredFile(key)).text()));
    const images = await attachedImages(previous?.previews[0]?.key, [...(starting?.preview ? [starting.preview] : []), ...await Promise.all(sourceKeys.map(renderOf))], ctx.references);
    const { result, runId } = await runRole({
      role: "svg",
      stepId: node.iteration ? node.id : "svg",
      iteration: node.iteration,
      projectId: model.projectId,
      batchId: batch.id,
      modelId: model.id,
      input: await roleInput("svg", {
        design: batch.design,
        name: model.name,
        request: ctx.request + workshopContext(batch.workshop, false),
        size: "Square vector canvas, 1:1 aspect ratio. Use a square viewBox; vector units are not a raster resolution.",
        source: source.join("\n\n"),
        images: images.notes,
        previous: previous ? await (await readStoredFile(previous.key)).text() : "None",
        feedback: feedback ? JSON.stringify(feedback, null, 2) : "None",
      }),
      images: images.keys,
    });
    let svg: string;
    try {
      svg = validateSvg(result.svg);
    } catch (error) {
      await db.update(runs).set({ status: "failed", error: String(error) }).where(eq(runs.id, runId));
      throw error;
    }
    const rendered = await renderSvg(svg);
    const storage = getStorage();
    const key = `${directory}/graphic.svg`;
    const previews = [
      { key: `${directory}/preview.png`, label: "full-size render (768 px) on white", data: rendered.full },
      { key: `${directory}/preview-64.png`, label: "64 px render on white, for legibility at small size", data: rendered.small },
      { key: `${directory}/preview-24.png`, label: "24 px render on white, for UI icon legibility when requested", data: rendered.icon },
    ];
    await storage.upload(new Blob([svg], { type: "image/svg+xml" }), key);
    for (const preview of previews) await storage.upload(png(preview.data), preview.key);
    const analysis = { ...analyzeSvg(svg), render: rendered.ink };
    await db.update(runs).set({ result: { ...result, key, analysis } }).where(eq(runs.id, runId));
    return { key, previews: previews.map(({ key, label }) => ({ key, label })), analysis };
  },
};
