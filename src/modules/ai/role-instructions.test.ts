import { expect, test } from "bun:test";
import { roleInstructions } from "./internal/role-instructions.server";
import { agentSettings } from "./index.server";
import { svgGuides } from "../../lib/workshop";
test("conditional guides follow the asset and stage while saved bundles win", async () => {
  const bundle = await roleInstructions("builder", undefined, {
    request: "a tree",
    stage: "geometry",
  });
  expect(bundle).toContain("Construction vocabulary");
  expect(bundle).not.toContain("Architecture and hard-surface construction");
  expect(
    await roleInstructions("builder", "saved", {
      request: "a tree",
      stage: "geometry",
    }),
  ).toBe("saved");
});

test("builder and judge receive their focused references without cross-role instructions", async () => {
  const builder = await roleInstructions("builder");
  expect(builder).toContain("Reference-led construction");
  expect(builder).toContain('asset_workspace(operation="run", mode="quick")');
  expect(builder).toContain("saved asset.py script");
  expect(builder).toContain("Pass the returned sha256 as expectedSha256");
  expect(builder).toContain("Architecture and hard-surface construction");
  expect(builder).toContain("Organic forms and trees");
  expect(builder).toContain("Deliberate UV and texture placement");
  expect(builder).not.toContain(
    "## Diagnose construction and material failures",
  );
  const judge = await roleInstructions("judge");
  expect(judge).toContain("## Diagnose construction and material failures");
  expect(judge).not.toContain("## Architecture and hard-surface construction");
  expect(await roleInstructions("photographer")).not.toContain(
    "## Reference-led construction",
  );
});

test("saved instructions survive new reference bundles, including empty historical snapshots", async () => {
  expect(
    await roleInstructions("builder", "original session instructions"),
  ).toBe("original session instructions");
  expect(await roleInstructions("judge", "")).toBe("");
});

test("agent settings include authored prompts and shared references", async () => {
  const settings = await agentSettings();
  const builder = settings.find((agent) => agent.id === "builder");
  expect(builder?.promptFiles.map((file) => file.path)).toEqual([
    "prompts/models/builder.md",
    "prompts/references/modeling-method.md",
    "prompts/references/hard-surface.md",
    "prompts/references/organic-and-trees.md",
    "prompts/references/uv-and-materials.md",
    "prompts/references/assetkit.md",
    "prompts/references/game-interfaces.md",
    "prompts/models/builder-input.md",
  ]);
  expect(builder?.promptFiles[0]?.content).toContain(
    "You are a Blender artist",
  );
  expect(settings.find((agent) => agent.id === "production-planner")?.promptFiles.map((file) => file.path)).toEqual([
    "prompts/models/production-planner.md",
    "prompts/references/uv-and-materials.md",
    "prompts/references/assetkit.md",
    "prompts/models/production-planner-input.md",
  ]);
  expect(
    settings.find((agent) => agent.id === "visual-target")?.promptFiles,
  ).toHaveLength(1);
});

test("graphic roles stay focused on two-dimensional deliverables", async () => {
  const designer = await roleInstructions("graphic-designer");
  const planner = await roleInstructions("graphic-planner");
  expect(designer).toContain("coherent graphics collection");
  expect(designer).not.toContain("ground-center origins");
  expect(planner).toContain("distinct, useful graphics");
  expect(planner).not.toContain("grounded dimensions");
});

test("SVG builders and judges receive only the guide for their intent", async () => {
  const icon = await roleInstructions("svg", undefined, undefined, svgGuides("builder", "icon"));
  expect(icon).toContain("## Outline icons");
  expect(icon).toContain("SVG construction studies");
  for (const intent of ["logo", "illustration"] as const) {
    const bundle = await roleInstructions("svg", undefined, undefined, svgGuides("builder", intent));
    expect(bundle).toContain(`## Intent: ${intent}`);
    expect(bundle).not.toContain("## Outline icons");
    expect(bundle).not.toContain("SVG construction studies");
    const judge = await roleInstructions("svg-judge", undefined, undefined, svgGuides("judge", intent));
    expect(judge).toContain(`## Intent: ${intent}`);
    expect(judge).not.toContain("unlabeled reading");
    expect(judge).not.toContain("Junction audit");
  }
  expect(await roleInstructions("svg-judge", undefined, undefined, svgGuides("judge", "icon"))).toContain("unlabeled reading");
});
