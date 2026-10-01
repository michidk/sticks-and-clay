import { expect, test } from "bun:test";
import { roleInstructions } from "./internal/role-instructions.server";
import { agentSettings } from "./index.server";

test("builder and judge receive their focused references without cross-role instructions", async () => {
  const builder = await roleInstructions("builder");
  expect(builder).toContain("Reference-led construction");
  expect(builder).toContain("Architecture and hard-surface construction");
  expect(builder).toContain("Organic forms and trees");
  expect(builder).toContain("Deliberate UV and texture placement");
  expect(builder).not.toContain("## Diagnose construction and material failures");
  const judge = await roleInstructions("judge");
  expect(judge).toContain("## Diagnose construction and material failures");
  expect(judge).not.toContain("## Architecture and hard-surface construction");
  expect(await roleInstructions("photographer")).not.toContain("## Reference-led construction");
});

test("saved instructions survive new reference bundles, including empty historical snapshots", async () => {
  expect(await roleInstructions("builder", "original session instructions")).toBe("original session instructions");
  expect(await roleInstructions("judge", "")).toBe("");
});

test("agent settings include authored prompts and shared references", async () => {
  const settings = await agentSettings();
  const builder = settings.find((agent) => agent.id === "builder");
  expect(builder?.promptFiles.map((file) => file.path)).toEqual([
    "prompts/builder.md",
    "prompts/references/modeling-method.md",
    "prompts/references/hard-surface.md",
    "prompts/references/organic-and-trees.md",
    "prompts/references/uv-and-materials.md",
    "prompts/builder-input.md",
  ]);
  expect(builder?.promptFiles[0]?.content).toContain(
    "You are a Blender artist",
  );
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
