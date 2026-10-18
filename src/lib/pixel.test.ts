import { expect, test } from "bun:test";
import sharp from "sharp";
import { analyzePixels, enlarged, validatePixelGrid, validatePixelPalette, type PixelGrid } from "./pixel";
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

test("measurements flag what wastes a palette: near-duplicates, pure black or white, halos and off-palette colors", () => {
  const rows = ["abcd", "abcd", "abcd", "abce"];
  const palette = [
    { key: "a", color: "#000000" }, { key: "b", color: "#102030" }, { key: "c", color: "#112233" },
    { key: "d", color: "#ffffff" }, { key: "e", color: "#ff000080" },
  ];
  const stats = analyzePixels(grid(rows, palette), [{ colors: ["#102030", "#ffffff"] }]);
  expect(stats.nearDuplicateColors).toEqual([{ keys: ["b", "c"], distance: 4 }]);
  expect(stats.pureBlackOrWhiteKeys).toEqual(["a", "d"]);
  expect(stats.semiTransparentCells).toBe(1);
  expect(stats.colorsOutsideNamedPalette).toEqual(["a", "c", "e"]);
  expect(analyzePixels(heart).nearDuplicateColors).toBeUndefined();
  expect(analyzePixels(heart).colorsOutsideNamedPalette).toBeUndefined();
});

test("a named classic palette in the brief is expanded to its exact colors", async () => {
  const { namedPalettes, palettePromptText } = await import("./pixel-palettes");
  expect(namedPalettes("A 16x16 icon set in the Game Boy palette").map((p) => p.id)).toEqual(["game boy"]);
  expect(namedPalettes("PICO-8 colors, or maybe DB16").map((p) => p.id)).toEqual(["pico8", "db16"]);
  expect(namedPalettes("a warm custom palette")).toEqual([]);
  expect(palettePromptText([])).toBe("None");
  expect(palettePromptText(namedPalettes("game boy"))).toContain("#0f380f #306230 #8bac0f #9bbc0f");
});

test("a saved pixel image is shown to vision models through its enlarged copy", () => {
  expect(enlarged("graphics/m/a/iteration-1/pixel.png")).toBe("graphics/m/a/iteration-1/preview.png");
  expect(enlarged("references/photo.png")).toBe("references/photo.png");
});

test("review evidence handles maximum-size rectangular grids and keeps exact native art", async () => {
  const drawing = grid(Array.from({ length: 4 }, () => "o".repeat(128)));
  const result = await renderPixels(drawing);
  expect(await sharp(result.review).metadata()).toMatchObject({ width: 1248, height: 832 });
  expect(await sharp(result.native).metadata()).toMatchObject({ width: 128, height: 4 });
});

test("named palettes reject off-palette RGB while allowing clear backgrounds and explicit alpha", () => {
  expect(() => validatePixelPalette(heart, [{ colors: ["#102030"] }])).toThrow("keys h");
  expect(() => validatePixelPalette(heart, [])).not.toThrow();
  expect(() => validatePixelPalette(heart, [{ colors: ["#102030", "#ffd060"] }])).not.toThrow();
  const alpha = grid(["oooo", "oooo", "oooo", "oooo"], [{ key: "o", color: "#10203080" }]);
  expect(() => validatePixelPalette(alpha, [{ colors: ["#102030"] }])).not.toThrow();
});

test("local transition evidence distinguishes flat fills from checkerboard texture", () => {
  const flat = analyzePixels(grid(Array(8).fill("oooooooo")));
  const noisy = analyzePixels(grid(Array.from({ length: 8 }, (_, y) => y % 2 ? "hohohoho" : "ohohohoh")));
  expect(flat.busiestPatch.ratio).toBe(0);
  expect(noisy.busiestPatch).toMatchObject({ left: 0, top: 0, width: 8, height: 8, ratio: 1 });
  expect(flat.valueRange?.span).toBe(0);
  expect(noisy.valueRange!.span).toBeGreaterThan(100);
  expect(analyzePixels(grid(Array(4).fill("...."))).valueRange).toBeNull();
});
