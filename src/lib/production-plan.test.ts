import { expect, test } from "bun:test";
import { productionPlanResult } from "./production-plan";

test("production plans require explicit texture targets and export checks", () => {
  const result = productionPlanResult.safeParse({
    version: 1,
    surfaceStrategy: "image-textures",
    summary: "A rounded rock needs a stable hull, a restrained snow cap and deliberate surface bindings.",
    materials: [{
      name: "rock",
      purpose: "The continuous stone body and its visible faceted color variation.",
      nodeTargets: ["rock_body"],
      slotName: "rock_surface",
    }],
    textures: [{
      mode: "generate",
      name: "rock_surface",
      purpose: "A quiet, cool-grey base color with sparse directional facets.",
      targets: ["rock_body"],
      baseColorPrompt: "Flat seamless cool-grey stone swatch with sparse broad planar variation, no lighting or shadows.",
      normalStrategy: "Use restrained tangent-space relief derived from the authored stone height, not color boundaries.",
      uvStrategy: "Use a deliberate unwrap with consistent world scale across the body and no stretched crown islands.",
      scale: "0.25 m repeat",
    }],
    steps: ["Build and verify the named watertight hull before assigning surface detail."],
    checks: ["Verify the exported material has the planned base-color and tangent normal bindings."],
  });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.textures[0]?.mode).toBe("generate");
});

test("production plans reject a generated texture without a normal strategy", () => {
  const result = productionPlanResult.safeParse({
    version: 1,
    surfaceStrategy: "image-textures",
    summary: "A valid enough summary for the schema boundary.",
    materials: [],
    textures: [{ mode: "generate", name: "stone", purpose: "Stone texture", targets: ["body"], baseColorPrompt: "Flat stone swatch without lighting or shadows." }],
    steps: ["Build the body."],
    checks: ["Check the export."],
  });
  expect(result.success).toBe(false);
});

test("plans allow flat colors, vertex colors and saved plans without a strategy", () => {
  for (const surfaceStrategy of [undefined, "flat-color", "vertex-colors"]) {
    const plan = productionPlanResult.parse({
      version: 1, surfaceStrategy,
      summary: "Broad painted color variation follows the rock geometry without image textures.",
      materials: [], textures: [],
      steps: ["Bind the chosen colors to the exported material."],
      checks: ["Verify colors survive GLB export in every rendered view."],
    });
    expect(plan.textures).toEqual([]);
    expect(plan.surfaceStrategy).toBe(surfaceStrategy);
  }
});
