import { expect, test } from "bun:test";
import { branchInput } from "./api-inputs";
import { attachedImagesChange, referencedChange, versionObjectReferences } from "./object-reference";

test("a refinement snapshots the object, hierarchy and source version into the agent request", () => {
  const reference = { glb: "versions/one/asset.glb", nodeId: "0/0/2", name: "wheel_fl", path: ["Scene", "sedan", "wheel_fl"] };
  const change = referencedChange("Make this smaller", "saved-build", reference);
  expect(change).toContain("Make this smaller");
  expect(change).toContain("Selected object from saved version saved-build:");
  expect(change).toContain('"wheel_fl"');
  expect(change).toContain('"sedan"');
  expect(change).toContain('"glb": "versions/one/asset.glb"');
  expect(referencedChange("Make this smaller", "saved-build", [reference])).toBe(change);
  expect(referencedChange("Change the paint", "saved-build")).toBe("Change the paint");
  expect(referencedChange("Change the paint", "saved-build", [])).toBe("Change the paint");
});

test("several selected parts are listed together", () => {
  const wheel = { glb: "a.glb", nodeId: "0/0/2", name: "wheel_fl", path: ["Scene", "wheel_fl"] };
  const door = { glb: "a.glb", nodeId: "0/0/3", name: "door_l", path: ["Scene", "door_l"] };
  const change = referencedChange("Paint these red", "saved-build", [wheel, door]);
  expect(change).toContain("Selected objects from saved version saved-build:");
  expect(change).toContain('"wheel_fl"');
  expect(change).toContain('"door_l"');
  expect(versionObjectReferences({ objectReference: wheel })).toEqual([wheel]);
  expect(versionObjectReferences({ objectReference: wheel, objectReferences: [wheel, door] })).toEqual([wheel, door]);
  expect(versionObjectReferences({})).toEqual([]);
});

test("attached images are announced to the agents only when present", () => {
  expect(attachedImagesChange("Match this", [])).toBe("Match this");
  expect(attachedImagesChange("Match this", null)).toBe("Match this");
  expect(attachedImagesChange("Match this", ["references/a.png"])).toContain("attached one image");
  expect(attachedImagesChange("Match this", ["references/a.png", "references/b.png"])).toContain("attached 2 images");
});

test("branch inputs reject malformed and unbounded object references", () => {
  const input = { kind: "iterate", sourceRunId: crypto.randomUUID(), prompt: "Change this", judgeIterations: 0 };
  const reference = { glb: "asset.glb", nodeId: "0/1", name: "wheel", path: ["Scene", "wheel"] };
  expect(branchInput.safeParse(input).success).toBe(true);
  expect(branchInput.safeParse({ ...input, objectReference: { glb: "asset.glb", nodeId: "../../x", name: "wheel", path: [] } }).success).toBe(false);
  expect(branchInput.safeParse({ ...input, objectReferences: [reference] }).success).toBe(true);
  expect(branchInput.safeParse({ ...input, objectReferences: Array.from({ length: 9 }, () => reference) }).success).toBe(false);
});
