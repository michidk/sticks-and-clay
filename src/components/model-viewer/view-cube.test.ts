import { expect, test } from "bun:test";
import { faceVector } from "./view-cube";

test("fixed viewer faces map to camera direction vectors", () => {
  expect(faceVector("front", "front")).toEqual([0, 0, 1]);
  expect(faceVector("right", "right")).toEqual([1, 0, 0]);
  expect(faceVector("back", "back")).toEqual([0, 0, -1]);
  expect(faceVector("left", "left")).toEqual([-1, 0, 0]);
  expect(faceVector("top", "right")[1]).toBe(1);
  expect(faceVector("bottom", "front")[1]).toBe(-1);
});
