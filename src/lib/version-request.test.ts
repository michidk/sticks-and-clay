import { expect, test } from "bun:test";
import { versionRequest } from "./version-request";
import { referencedChange } from "./object-reference";
import { prompt } from "./prompts.server";

test("snowball iteration gives the latest owner change precedence over inherited prohibitions", () => {
  const inherited = "One watertight snowball shell; no protrusions. Keep its centre pivot.\n\nRequested change from saved version:\nadd textures\n\nRequested change from saved version:\nmaybe some sticks look out/?\n\nRequested change from saved version:\nsticks sticking out.. les regular";
  const request = versionRequest({ prompt: inherited, sourceRunId: "saved-snowball", changePrompt: "sticks sticking out.. les regular" });
  expect(request).toContain("LATEST OWNER CHANGE\nsticks sticking out.. les regular");
  expect(request).toContain("overrides conflicting requirements");
  expect(request).toContain("later changes replace conflicting earlier ones");
  expect(request).toContain("missing requested geometry is a major defect");
  expect(request.endsWith(inherited)).toBe(true);
});

test("ordinary generation keeps its brief and cannot infer revisions from embedded text", () => {
  const original = "A snowball. Requested change from saved version: is literal reference text.";
  expect(versionRequest({ prompt: original, sourceRunId: null, changePrompt: null })).toBe(original);
  expect(versionRequest({ prompt: original, sourceRunId: "source", changePrompt: null })).toBe(original);
});

test("owner changes retain the selected object and preserve unrelated parts", () => {
  const request = referencedChange(versionRequest({ prompt: "A door and frame", sourceRunId: "source", changePrompt: "Add a handle" }), "source", {
    glb: "versions/source/asset.glb", nodeId: "0/1", name: "door", path: ["root", "door"],
  });
  expect(request).toContain("LATEST OWNER CHANGE\nAdd a handle");
  expect(request).toContain('"name": "door"');
  expect(request).toContain("Preserve unrelated parts");
});

test("target, planner, builder and judge templates all receive the same revision contract", async () => {
  const request = versionRequest({ prompt: "Snowball without protrusions", sourceRunId: "source", changePrompt: "Add protruding sticks" });
  const values = { request, assetType: "model", design: "Winter collection", name: "Snowball", context: "", evidence: "Image 1: target", guidance: "", version: 1, capability: "fixture", directory: "fixture", previous: "source.blend", feedback: "null", stage: "geometry", productionPlan: "{}", target: "Image 1", metrics: "{}", analysis: "{}" };
  for (const template of ["generation/visual-target", "models/production-planner-input", "models/builder-input", "models/judge-input"])
    expect(await prompt(template, values)).toContain(request);
});
