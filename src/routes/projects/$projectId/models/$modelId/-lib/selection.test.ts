import { expect, test } from "bun:test";
import { objectReferenceFromNode } from "./selection";

test("references distinguish identically named parts by their full ancestor path", () => {
  const inspection = { dimensions: [1, 1, 1] as [number, number, number], triangles: 12, materials: 1, textures: 0,
    nodes: [
      { id: "0", name: "Scene", type: "Group", depth: 0, mesh: false },
      { id: "0/0", name: "front_axle", type: "Group", depth: 1, mesh: false },
      { id: "0/0/0", name: "wheel", type: "Mesh", depth: 2, mesh: true },
      { id: "0/1", name: "rear_axle", type: "Group", depth: 1, mesh: false },
      { id: "0/1/0", name: "wheel", type: "Mesh", depth: 2, mesh: true },
    ] };
  expect(objectReferenceFromNode("saved.glb", inspection, "0/1/0")).toEqual({ glb: "saved.glb", nodeId: "0/1/0", name: "wheel", path: ["Scene", "rear_axle", "wheel"] });
  expect(objectReferenceFromNode("saved.glb", inspection, "0/1")).toBeNull();
  expect(objectReferenceFromNode("saved.glb", inspection, "missing")).toBeNull();
});
