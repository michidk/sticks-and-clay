import { expect, test } from "bun:test";
import sharp from "sharp";
import { analyzePixels, validatePixelGrid, type PixelGrid } from "./pixel";
import { renderPixels } from "./pixel-render.server";

const grid = (rows: string[], palette = [{ key: ".", color: "transparent" }, { key: "o", color: "#102030" }, { key: "h", color: "#ffd060" }]): PixelGrid =>
  ({ width: rows[0].length, height: rows.length, palette, rows });
const heart = grid(["....", ".oo.", "ohho", "o..o"]);

test("a grid is checked cell by cell and the first problem is named", () => {
  expect(validatePixelGrid(heart).keys.join("")).toBe("....".concat(".oo.", "ohho", "o..o"));
  expect(() => validatePixelGrid({ ...heart, rows: ["....", ".oo.", "ohho"] })).toThrow("Expected 4 rows, got 3");
  expect(() => validatePixelGrid({ ...heart, rows: ["....", ".oo.", "oho", "o..o"] })).toThrow("Row 3 has 3 cells; expected 4");
  expect(() => validatePixelGrid({ ...heart, rows: ["....", ".oo.", "ohxo", "o..o"] })).toThrow('Row 3, column 3: "x" is not in the palette');
  expect(() => validatePixelGrid({ ...heart, palette: [...heart.palette, { key: "o", color: "#000000" }] })).toThrow("defined twice");
  expect(() => validatePixelGrid({ ...heart, palette: [{ key: ".", color: "blue" }, ...heart.palette.slice(1)] })).toThrow("must be #rrggbb");
});

test("measurements describe palette use, placement and stray cells", () => {
  const stats = analyzePixels(grid(["....", ".o..", "....", "...h"], [...heart.palette, { key: "z", color: "#ffffff" }]));
  expect(stats).toMatchObject({ size: "4x4", colorsUsed: 2, paletteEntriesUnused: ["z"], isolatedCells: 2, touchesEdge: ["right", "bottom"] });
  expect(analyzePixels(heart)).toMatchObject({ isolatedCells: 0, touchesEdge: ["left", "right", "bottom"], marginsInCells: { top: 1, left: 0, right: 0, bottom: 0 } });
  expect(analyzePixels(grid(["....", "....", "....", "...."]))).toMatchObject({ empty: true });
});

test("rendering keeps one pixel per cell and enlarges the preview without smoothing", async () => {
  const { native, preview, scale } = await renderPixels(heart);
  expect(scale).toBe(192);
  const small = await sharp(native).raw().toBuffer({ resolveWithObject: true });
  expect([small.info.width, small.info.height]).toEqual([4, 4]);
  expect([...small.data.subarray((1 * 4 + 1) * 4, (1 * 4 + 1) * 4 + 4)]).toEqual([0x10, 0x20, 0x30, 255]); // 'o'
  expect(small.data[3]).toBe(0); // '.' is transparent
  const big = await sharp(preview).raw().toBuffer({ resolveWithObject: true });
  expect(big.info.width).toBe(768);
  const at = (x: number, y: number) => [...big.data.subarray((y * 768 + x) * big.info.channels, (y * 768 + x) * big.info.channels + 3)];
  expect(at(192 + 1, 192 + 1)).toEqual([0x10, 0x20, 0x30]); // inside the 'o' cell, not blended with a neighbour
  expect(at(192 * 2 - 1, 192 + 1)).toEqual([0x10, 0x20, 0x30]); // the cell's far edge is still the same color
  expect(at(5, 5)).toEqual([255, 255, 255]); // transparent shows white
});
