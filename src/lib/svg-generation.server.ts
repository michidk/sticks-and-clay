import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { runRole, roleInput } from "../modules/ai/index.server";
import type { AssetKind } from "./reviewed-asset.server";
import { getStorage, readStoredFile } from "./storage.server";
import { analyzeSvg, validateSvg, viewableReferences } from "./svg";
import { renderSvg } from "./svg-render.server";
import { svgGuides, svgIntentOf, workshopContext } from "./workshop";

const png = (data: Buffer) => new Blob([new Uint8Array(data)], { type: "image/png" });

/** The images shown to the SVG model, with a line telling it what each one is. Renders come first,
 * so the model sees what the earlier markup actually looks like instead of reading code alone. */
export async function attachedImages(previousPreviews: { key: string; label: string }[], sourceRenders: string[], references: string[]) {
  // Restored versions can carry their SVG source as the fallback preview.
  const previous = await Promise.all(previousPreviews.map(async ({ key, label }) => ({
    key: key.endsWith(".svg") ? await renderOf(key) : key,
    note: `render of the PREVIOUS ATTEMPT SVG: ${label}`,
  })));
  const entries = [
    ...previous,
    ...sourceRenders.map((key) => ({ key, note: "render of the SAVED SOURCE SVG, on white" })),
    ...viewableReferences(references).map((key) => ({ key, note: "reference material; use the brief and reference notes to distinguish anatomy from style" })),
  ];
  return {
    keys: entries.map((entry) => entry.key),
    notes: entries.map((entry, index) => `Image ${index + 1}: ${entry.note}`).join("\n") || "None",
  };
}

/** A PNG render saved beside an SVG, made now for sources that have none. */
async function renderOf(svgKey: string) {
  const key = `${svgKey}.reference.png`;
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
    const intent = svgIntentOf(batch.workshop);
    // Iteration 0 keeps the one-shot layout so jobs saved before review rounds resume unchanged.
    const base = `graphics/${model.id}/${ctx.attempt}`;
    const directory = node.iteration ? `${base}/iteration-${node.iteration}` : base;
    const starting = batch.workshop?.startingPoint;
    const startingSources = starting?.format === "svg" ? [starting.key.replace(/source\.svg$/, "editable.svg")] : [];
    const sourceKeys = [...startingSources, ...ctx.references.filter((key) => key.endsWith(".svg"))];
    const referenceEvidence = await Promise.all(ctx.references.map(async (key) => ({
      key: key.endsWith(".svg") ? await renderOf(key) : key,
      label: "reference material; anatomy or style as specified in the brief and reference notes",
    })));
    const source = await Promise.all(sourceKeys.map(async (key) => (await readStoredFile(key)).text()));
    const images = await attachedImages(previous?.previews ?? [], [...(starting?.preview ? [starting.preview] : []), ...await Promise.all(startingSources.map(renderOf))], referenceEvidence.map(({ key }) => key));
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
      guides: svgGuides("builder", intent),
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
    const all = [
      { key: `${directory}/preview.png`, label: "full-size render (768 px) on white", data: rendered.full, intents: ["icon", "logo", "illustration"] },
      { key: `${directory}/preview-64.png`, label: "64 px render on white, for legibility at small size", data: rendered.small, intents: ["icon", "logo", "illustration"] },
      { key: `${directory}/preview-24.png`, label: "24 px render on white, for UI icon legibility when requested", data: rendered.icon, intents: ["icon"] },
      { key: `${directory}/preview-16.png`, label: "16 px render on white", data: rendered.tiny, intents: ["icon", "logo"] },
      { key: `${directory}/preview-dark-64.png`, label: "64 px render on dark; currentColor is light, fixed paints unchanged", data: rendered.darkSmall, intents: ["icon", "logo"] },
      { key: `${directory}/preview-dark-24.png`, label: "24 px render on dark; currentColor is light, fixed paints unchanged", data: rendered.darkIcon, intents: ["icon"] },
      { key: `${directory}/preview-dark-16.png`, label: "16 px render on dark; currentColor is light, fixed paints unchanged", data: rendered.darkTiny, intents: ["icon", "logo"] },
    ];
    // Illustrations are judged at full size and 64 px; logos add the favicon size and dark backgrounds.
    const previews = all.filter((preview) => preview.intents.includes(intent));
    await storage.upload(new Blob([svg], { type: "image/svg+xml" }), key);
    for (const preview of previews) await storage.upload(png(preview.data), preview.key);
    const analysis = { ...analyzeSvg(svg), render: rendered.ink };
    const viewBox = analysis.viewBox?.trim().split(/[\s,]+/).map(Number);
    const dimensionErrors = viewBox && viewBox[2] !== viewBox[3]
      ? ["Output dimension error: SVG requires a square viewBox (1:1). The returned vector canvas is not square."] : [];
    const touchesEdge = rendered.ink.empty ? [] : rendered.ink.touchesEdge;
    const iconQualityIssues = intent === "icon" ? [
      ...(analysis.quality?.square24 ? [] : ["Icon construction should use viewBox=\"0 0 24 24\" unless the approved design explicitly specifies another grid."]),
      ...(analysis.quality?.consistentStroke ? [] : ["Icon strokes do not share one width, cap, and join; normalize the shared construction before export."]),
      ...(rendered.ink.empty ? ["The rendered icon contains no visible ink."] : []),
      ...(touchesEdge.length ? [`Icon ink touches the canvas edge: ${touchesEdge.join(", ")}. Leave a visible safety margin.`] : []),
      ...(analysis.quality?.duplicateSegments ? [`${analysis.quality.duplicateSegments} duplicate stroke segment(s) detected; draw shared edges once.`] : []),
      ...(analysis.quality?.nearEndpointPairs ? [`${analysis.quality.nearEndpointPairs} near endpoint pair(s) detected; inspect handles, rims, and interior details for accidental tangencies.`] : []),
    ] : [];
    const enrichedAnalysis = { ...analysis, quality: { ...analysis.quality, issues: iconQualityIssues } };
    await db.update(runs).set({ result: { ...result, key, analysis: enrichedAnalysis, dimensionErrors, previews: previews.map(({ key, label }) => ({ key, label })) } }).where(eq(runs.id, runId));
    return { key, dimensionErrors, referenceEvidence, previews: previews.map(({ key, label }) => ({ key, label })), analysis: enrichedAnalysis };
  },
};
