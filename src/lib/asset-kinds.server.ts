import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import type { AssetType } from "./asset-types";
import { runImageRole } from "../modules/ai/index.server";
import { prompt } from "./prompts.server";
import { assertJobActive } from "./queue.server";
import type { AssetKind } from "./reviewed-asset.server";
import { pixelKind } from "./pixel-generation.server";
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
    const generated = [];
    for (const [index, part] of (parts.length ? parts : [undefined]).entries()) {
      const previousKey = part
        ? previous?.parts?.find((item) => item.name === part.name)?.key
        : previous?.key;
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
          : "") + revision,
        size: batch.imageSize,
        images: [...(previousKey ? [previousKey] : []), ...ctx.references],
        assertActive: assertJobActive,
      });
      generated.push(image);
      outputs.push({ name: part?.name ?? model.name, key: image.key });
    }
    const [first] = outputs;
    if (!first) throw new Error("No graphic was produced");
    const previews = outputs.map(({ name, key }) => ({ key, label: parts.length ? `named part ${JSON.stringify(name)}` : "the generated graphic" }));
    const analysis = parts.length ? { parts: outputs.map(({ name }) => name) } : {};
    if (parts.length) for (const image of generated) await db.update(runs)
      .set({ result: { ...image, parts: outputs, previews, analysis } })
      .where(eq(runs.id, image.runId));
    return {
      key: first.key,
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
  graphic: graphicKind,
  svg: svgKind,
  pixel: pixelKind,
};
