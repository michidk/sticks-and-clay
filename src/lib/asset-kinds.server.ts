import { resolutionSchema } from "./contracts";
import { checkpoint, readCheckpoint } from "./checkpoint.server";
import { pngResolution } from "./resolution.server";
import { dimensionError, imageCanvas } from "./resolution";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import type { AssetType } from "./asset-types";
import { runImageRole } from "../modules/ai/index.server";
import { prompt } from "./prompts.server";
import { assertJobActive } from "./queue.server";
import type { AssetKind } from "./reviewed-asset.server";
import { pixelKind } from "./pixel-generation.server";
import { cadKind } from "./cad-generation.server";
import { svgKind } from "./svg-generation.server";
import { workshopContext } from "./workshop";

/** Raster graphics come from the image API; the judge looks at the image itself. */
const graphicKind: AssetKind = {
  format: "png",
  judge: "graphic-judge",
  async build(ctx, { node, previous, feedback }) {
    const { model, batch } = ctx;
    const revision = feedback
      ? "\n\nREVISION\nA reviewer found problems in the first image, supplied as the first reference. Keep what works and fix these, in priority order:\n" +
        feedback.improvements.map((i) => `- [${i.priority}] ${i.issue} → ${i.action}`).join("\n")
      : "";
    const basePrompt =
      (await prompt("graphics/graphic", { design: batch.design, name: model.name, request: ctx.request })) +
      workshopContext(batch.workshop, false);
    const parts = batch.workshop?.parts ?? [];
    const outputs = [];
    const dimensionErrors: string[] = [];
    const generated = [];
    for (const [index, part] of (parts.length ? parts : [undefined]).entries()) {
      const previousKey = part
        ? previous?.parts?.find((item) => item.name === part.name)?.key
        : previous?.key;
      const sourceKey = previousKey ?? batch.workshop?.startingPoint?.preview;
      const checkpointKey = `output:resolution:${index}`;
      const frozen = readCheckpoint(checkpointKey, resolutionSchema);
      const resolution = batch.workshop?.resolution ?? frozen ?? (sourceKey ? await pngResolution(sourceKey) : undefined);
      const size = imageCanvas(resolution, batch.imageSize);
      const [width, height] = size.split("x").map(Number);
      if (!frozen) await checkpoint(checkpointKey, JSON.stringify({ width, height }));
      const image = await runImageRole({
        role: "graphic",
        name: part ? `part-${index + 1}-${node.iteration}` : node.iteration ? `graphic-${node.iteration}` : "graphic",
        stepId: part ? `${node.id}:part:${index + 1}` : node.iteration ? node.id : "graphic",
        iteration: node.iteration,
        projectId: model.projectId,
        batchId: batch.id,
        modelId: model.id,
        directory: `graphics/${model.id}/${ctx.attempt}`,
        prompt: basePrompt + (part
          ? `\n\nNAMED PART OUTPUT\nGenerate only part ${JSON.stringify(part.name)} of this asset: ${part.brief}\nThe other named parts are generated as separate files in this same version. Keep their shared scale, alignment, palette and visual language consistent. Do not include other parts or a contact sheet in this file.`
          : "") + revision + (batch.workshop?.transparentBackground !== false ? "\n\nOUTPUT: Use a true transparent alpha background with no matte, border, or colored backdrop." : ""),
        size,
        images: [...(previousKey ? [previousKey] : batch.workshop?.startingPoint?.preview ? [batch.workshop.startingPoint.preview] : []), ...ctx.references],
        assertActive: assertJobActive,
        transparentBackground: batch.workshop?.transparentBackground !== false,
      });
      const mismatch = dimensionError(await pngResolution(image.key), { width, height });
      if (mismatch) dimensionErrors.push(part ? `${part.name}: ${mismatch}` : mismatch);
      generated.push(image);
      outputs.push({ name: part?.name ?? model.name, key: image.key });
    }
    const [first] = outputs;
    if (!first) throw new Error("No graphic was produced");
    const previews = outputs.map(({ name, key }) => ({ key, label: parts.length ? `named part ${JSON.stringify(name)}` : "the generated graphic" }));
    const analysis = { ...(parts.length ? { parts: outputs.map(({ name }) => name) } : {}), ...(dimensionErrors.length ? { dimensionErrors } : {}) };
    if (parts.length || dimensionErrors.length) for (const image of generated) await db.update(runs)
      .set({ result: { ...image, parts: outputs, previews, analysis } })
      .where(eq(runs.id, image.runId));
    return {
      key: first.key,
      dimensionErrors,
      ...(parts.length ? { parts: outputs } : {}),
      previews,
      analysis,
    };
  },
};

/** Typed over every non-3D asset type: adding a type without a kind fails to compile,
 * and every kind is reviewed by `runReviewedAsset`.
 */
export const assetKinds: Record<Exclude<AssetType, "model">, AssetKind> = {
  cad: cadKind,
  graphic: graphicKind,
  svg: svgKind,
  pixel: pixelKind,
};
