import { expect, test } from "bun:test";
import { assetTypes } from "./asset-types";
import { generationReferences, hasVisualTarget } from "./visual-target";
import { reviewEvidence } from "../modules/pipelines/evidence";

test("raster image generation is the only asset type without a preliminary target", () => {
  expect(assetTypes.filter(hasVisualTarget)).toEqual(["model", "svg", "pixel", "cad"]);
});

test("target evidence remains present beyond the supporting-reference limit and is never current output", () => {
  const references = generationReferences({ target: "target.png", references: ["style.png", "target.png"] });
  expect(references.map(({ key }) => key)).toEqual(["target.png", "style.png"]);
  const evidence = reviewEvidence({
    buildId: "test", current: [{ path: "actual.png", label: "rendered asset" }],
    references: references.map(({ key, label }) => ({ path: key, label })),
    parameters: {}, technical: {}, findings: undefined,
  });
  expect(evidence.images).toEqual(["actual.png", "target.png", "style.png"]);
  expect(evidence.labels).toContain("Image 2: approved visual target for this exact asset");
  expect(evidence.labels).toContain("(reference only)");
  expect(generationReferences({ references: [] })).toEqual([]);
});
