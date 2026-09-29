import { expect, test } from "bun:test";
import { faceVector, nearestFace, nextFace } from "./view-cube";

test("view arrows snap an isometric view to neighboring faces", () => {
  expect(nearestFace(2.6, 1.9, 2.6)).toBe("front");
  expect(nextFace("front", "up", "front")).toEqual({ face: "top", lastSide: "front" });
  expect(nextFace("front", "right", "front")).toEqual({ face: "right", lastSide: "right" });
  expect(nextFace("right", "down", "right")).toEqual({ face: "bottom", lastSide: "right" });
});

test("vertical arrows continue across the top and bottom faces", () => {
  expect(nextFace("top", "up", "front")).toEqual({ face: "back", lastSide: "front" });
  expect(nextFace("top", "down", "front")).toEqual({ face: "front", lastSide: "front" });
  expect(nextFace("bottom", "down", "right")).toEqual({ face: "left", lastSide: "right" });
  expect(nextFace("back", "up", "front")).toEqual({ face: "bottom", lastSide: "front" });
  expect(nextFace("back", "down", "front")).toEqual({ face: "top", lastSide: "front" });
  expect(faceVector("top", "right")[1]).toBe(1);
  expect(faceVector("bottom", "front")[1]).toBe(-1);
});

test("repeated up arrows visit four distinct faces before returning", () => {
  let state: { face: ReturnType<typeof nearestFace>; lastSide: ReturnType<typeof nearestFace> } = { face: "front", lastSide: "front" };
  const visited = [];
  for (let index = 0; index < 4; index++) {
    state = nextFace(state.face, "up", state.lastSide);
    visited.push(state.face);
  }
  expect(visited).toEqual(["top", "back", "bottom", "front"]);
});
