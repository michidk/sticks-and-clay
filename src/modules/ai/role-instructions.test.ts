import { expect, test } from "bun:test";
import { roleInstructions } from "./internal/role-instructions.server";

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
