import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { runRole, roleInput } from "../modules/ai/index.server";
import type { AssetKind } from "./reviewed-asset.server";
import { getStorage, readStoredFile } from "./storage.server";
import { analyzeSvg, validateSvg, viewableReferences } from "./svg";
import { renderSvg } from "./svg-render.server";

const png = (data: Buffer) => new Blob([new Uint8Array(data)], { type: "image/png" });

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
    const source = await Promise.all(
      ctx.references.filter((key) => key.endsWith(".svg")).map(async (key) => (await readStoredFile(key)).text()),
    );
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
        request: ctx.request,
        size: batch.imageSize,
        source: source.join("\n\n"),
        previous: previous ? await (await readStoredFile(previous.key)).text() : "None",
        feedback: feedback ? JSON.stringify(feedback, null, 2) : "None",
      }),
      images: viewableReferences(ctx.references),
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
    ];
    await storage.upload(new Blob([svg], { type: "image/svg+xml" }), key);
    for (const preview of previews) await storage.upload(png(preview.data), preview.key);
    const analysis = { ...analyzeSvg(svg), render: rendered.ink };
    await db.update(runs).set({ result: { ...result, key, analysis } }).where(eq(runs.id, runId));
    return { key, previews: previews.map(({ key, label }) => ({ key, label })), analysis };
  },
};
