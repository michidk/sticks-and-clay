import type { AssetType } from "./asset-types";

export const hasVisualTarget = (assetType: AssetType) => assetType !== "graphic";

export type VisualReference = { key: string; label: string };

/** The target is always separate from supporting references and candidate evidence. */
export function generationReferences({ target, references }: { target?: string | null; references: string[] }): VisualReference[] {
  return [
    ...(target ? [{ key: target, label: "approved visual target for this exact asset; match its design within the approved text and technical constraints" }] : []),
    ...references.filter((key) => key !== target).map((key) => ({ key, label: "supporting reference material; anatomy or style as specified in the brief and reference notes" })),
  ];
}

export const visualTargetGuides: Record<Exclude<AssetType, "graphic">, string> = {
  model: "generation/visual-target-model",
  cad: "generation/visual-target-cad",
  svg: "generation/visual-target-svg",
  pixel: "generation/visual-target-pixel",
};
