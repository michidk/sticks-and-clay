import { expect, test } from "bun:test";
import { validateCanvasEdit } from "./pixel-canvas";
import { editPixelCanvas } from "./pixel-edit";
import { resolvePixelAnswer } from "./pixel";
const grid = { width: 4, height: 4, palette: [{ key: ".", color: "transparent" }, { key: "x", color: "#284e3c" }], rows: ["x...", "....", "....", "...."], frames: [{ rows: ["....", "....", "....", "...x"] }], fps: 8, loop: true };
const edit = { width: 4, height: 4, palette: grid.palette, operations: [{ kind: "pixels" as const, key: "x", points: [{ x: 2, y: 2 }], target: null }] };

test("canvas edits preserve unrelated cells, frames, palette and timing", () => {
  validateCanvasEdit(edit, grid);
  const changed = resolvePixelAnswer(edit, grid);
  expect(changed.rows).toEqual(["x...", "....", "..x.", "...."]);
  expect(changed.frames).toEqual(grid.frames);
  expect(changed.fps).toBe(8);
  expect(grid.rows[2]).toBe("....");
});

test("canvas contracts reject resizing, recoloring, replacement and oversized batches", () => {
  expect(() => validateCanvasEdit({ ...edit, width: 8 }, grid)).toThrow("locked");
  expect(() => validateCanvasEdit({ ...edit, palette: [{ key: "x", color: "#ffffff" }] }, grid)).toThrow("palette");
  expect(() => validateCanvasEdit({ ...edit, rows: grid.rows }, grid)).toThrow("retained canvas");
  expect(() => validateCanvasEdit({ ...edit, fps: 12 }, grid)).toThrow("timing");
  expect(() => validateCanvasEdit({ ...edit, operations: Array(25).fill(edit.operations[0]) })).toThrow("24 operations");
});

test("manual painting and erasing target exact cells without modifying the source", () => {
  const changed = editPixelCanvas(grid, [{ x: 0, y: 0, key: ".", target: "base" }, { x: 0, y: 0, key: "x", target: "frame 2" }]);
  expect(changed.rows).toEqual(Array(4).fill("...."));
  expect(changed.frames?.[0].rows).toEqual(["x...", "....", "....", "...x"]);
  expect(grid.rows[0]).toBe("x...");
  expect(changed.palette).toEqual(grid.palette);
  expect(() => editPixelCanvas(grid, [{ x: 4, y: 0, key: "x", target: "base" }])).toThrow("outside");
  expect(() => editPixelCanvas(grid, [{ x: 0, y: 0, key: "z", target: "base" }])).toThrow("palette");
  expect(() => editPixelCanvas(grid, [{ x: 0, y: 0, key: "x", target: "missing" }])).toThrow("existing");
});
