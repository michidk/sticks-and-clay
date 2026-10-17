import type { projects } from "../db/schema";
import { runImageRole } from "../modules/ai/index.server";
import { prompt } from "./prompts.server";
import { assertJobActive } from "./queue.server";
import type { AssetKind } from "./reviewed-asset.server";
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
    const image = await runImageRole({
      role: "graphic",
      name: node.iteration ? `graphic-${node.iteration}` : "graphic",
      stepId: node.iteration ? node.id : "graphic",
      iteration: node.iteration,
      projectId: model.projectId,
      batchId: batch.id,
      modelId: model.id,
      directory: `graphics/${model.id}/${ctx.attempt}`,
      prompt:
        (await prompt("graphics/graphic", { design: batch.design, name: model.name, request: ctx.request })) +
        workshopContext(batch.workshop, false) +
        revision,
      size: batch.imageSize,
      images: [...(previous ? [previous.key] : []), ...ctx.references],
      assertActive: assertJobActive,
    });
    return { key: image.key, previews: [{ key: image.key, label: "the generated graphic" }], analysis: {} };
  },
};

/** Typed over every non-3D asset type: adding a type without a kind fails to compile,
 * and every kind is reviewed by `runReviewedAsset`.
 */
export const assetKinds: Record<Exclude<typeof projects.$inferSelect.assetType, "model">, AssetKind> = {
  graphic: graphicKind,
  svg: svgKind,
};
