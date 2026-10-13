import { expect, test } from "bun:test";
import { branchInput } from "./api-inputs";
import { referencedChange } from "./object-reference";

test("a refinement snapshots the object, hierarchy and source version into the agent request", () => {
  const reference = { glb: "versions/one/asset.glb", nodeId: "0/0/2", name: "wheel_fl", path: ["Scene", "sedan", "wheel_fl"] };
  const change = referencedChange("Make this smaller", "saved-build", reference);
  expect(change).toContain("Make this smaller");
  expect(change).toContain("Selected object from saved version saved-build:");
  expect(change).toContain('"wheel_fl"');
  expect(change).toContain('"sedan"');
  expect(change).toContain('"glb": "versions/one/asset.glb"');
  expect(referencedChange("Change the paint", "saved-build")).toBe("Change the paint");
});

test("branch inputs reject malformed and unbounded object references", () => {
  const input = { kind: "iterate", sourceRunId: crypto.randomUUID(), prompt: "Change this", judgeIterations: 0 };
  expect(branchInput.safeParse(input).success).toBe(true);
  expect(branchInput.safeParse({ ...input, objectReference: { glb: "asset.glb", nodeId: "../../x", name: "wheel", path: [] } }).success).toBe(false);
});
