import { expect, test } from "bun:test";
import sharp from "sharp";
import { analyzePixels, enlarged, validatePixelGrid, type PixelGrid } from "./pixel";
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

// ---- craft measurements -----------------------------------------------------------------------------------------

const fill = (size: number, key: (x: number, y: number) => string) =>
  Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => key(x, y)).join(""));
const four = [
  { key: ".", color: "transparent" }, { key: "a", color: "#3e2731" }, { key: "b", color: "#a22633" },
  { key: "c", color: "#e43b44" }, { key: "d", color: "#feae34" }, { key: "k", color: "#000000" }, { key: "g", color: "#808080" }, { key: "G", color: "#8a8a8a" },
];
const warningsOf = (rows: string[], presets: { colors: string[] }[] = []) => analyzePixels(grid(rows, four), presets).warnings;

test("measurements name a narrow value range, noise, pure black, a boxy outline and an upscaled drawing", () => {
  expect(warningsOf(fill(16, (x) => (x % 2 ? "g" : "G"))).some((w) => w.startsWith("VALUES:"))).toBe(true);
  expect(analyzePixels(grid(fill(16, (x) => (x % 2 ? "g" : "G")), four)).craft.valueRange).toBeLessThan(0.35);

  // Every interior cell differs from all 8 neighbours: speckle, not clusters.
  const speckle = analyzePixels(grid(fill(16, (x, y) => "abcd"[(x % 2) + 2 * (y % 2)]), four));
  expect(speckle.craft.loneInteriorCells).toBe(14 * 14);
  expect(speckle.warnings.some((w) => w.startsWith("NOISE:"))).toBe(true);

  const black = fill(16, (x) => (x < 8 ? "k" : "d"));
  expect(warningsOf(black).some((w) => w.startsWith("BLACK:"))).toBe(true);
  // A named palette that contains black (PICO-8) makes it a legal outline color.
  expect(warningsOf(black, [{ colors: ["#000000", "#feae34"] }]).some((w) => w.startsWith("BLACK:"))).toBe(false);

  const square = fill(32, (x, y) => (x && y && x < 31 && y < 31 ? "c" : "."));
  const boxy = analyzePixels(grid(square, four));
  expect(boxy.craft.boxyOutlineShare).toBeGreaterThan(0.35);
  expect(boxy.warnings.some((w) => w.startsWith("BOXY:"))).toBe(true);
  expect(boxy.warnings.some((w) => w.startsWith("COLORS: only 1 colors"))).toBe(true);

  // An 8x8 drawing enlarged to 16x16: every run is a whole number of 2x2 blocks.
  const upscaled = analyzePixels(grid(fill(16, (x, y) => "abc"[(Math.floor(x / 2) + 2 * Math.floor(y / 2)) % 3]), four));
  expect(upscaled.craft.pixelScale).toBe(2);
  expect(upscaled.craft.singleCellRunShare).toBe(0);
  expect(upscaled.warnings.some((w) => w.includes("8x8 drawing enlarged"))).toBe(true);
  expect(speckle.craft.pixelScale).toBe(1);
});

test("grid fit reports the content box, baseline gap, centre offset and the multiple-of-8 hint", () => {
  expect(analyzePixels(heart).gridFit).toEqual({
    contentBox: { left: 0, top: 1, right: 3, bottom: 3, width: 4, height: 3 }, baselineGap: 0, centerOffset: 0, canvasMultipleOf8: false,
  });
  expect(analyzePixels(heart).warnings.some((w) => w.startsWith("GRID:"))).toBe(true);
  const raised = analyzePixels(grid(fill(16, (x, y) => (x >= 2 && x < 6 && y >= 4 && y < 12 ? "c" : ".")), four));
  expect(raised.gridFit).toMatchObject({ baselineGap: 4, centerOffset: -4, canvasMultipleOf8: true });
});

// ---- named palettes ---------------------------------------------------------------------------------------------

test("a drawing outside the named palette is rejected with each key and its nearest legal color", async () => {
  const { enforcePalette, snapToPalette, offPaletteEntries, PixelPaletteError } = await import("./pixel");
  const gameBoy = { label: "Game Boy", colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"] };
  const art = grid(["....", ".oo.", "ohho", "o..o"], [...heart.palette, { key: "z", color: "#123456" }]);
  expect(() => enforcePalette(art, [gameBoy])).toThrow(PixelPaletteError);
  expect(() => enforcePalette(art, [gameBoy])).toThrow(/"o" #102030 \(nearest #0f380f\).*Use only the exact Game Boy values/);
  expect(offPaletteEntries(art, [gameBoy]).map((entry) => entry.key)).toEqual(["o", "h"]); // unused "z" does not count
  expect(() => enforcePalette(art, [])).not.toThrow();

  const { grid: snapped, snapped: changes } = snapToPalette(grid(["....", ".oo.", "ohho", "o..o"], [...heart.palette.slice(0, 2), { key: "h", color: "#ffd06080" }]), [gameBoy]);
  expect(changes.map((change) => change.key)).toEqual(["o", "h"]);
  expect(snapped.palette.find((entry) => entry.key === "o")?.color).toBe("#0f380f");
  expect(snapped.palette.find((entry) => entry.key === "h")?.color).toMatch(/^#[0-9a-f]{6}80$/); // alpha kept
  expect(snapped.palette.find((entry) => entry.key === ".")?.color).toBe("transparent");
  expect(offPaletteEntries(snapped, [gameBoy])).toEqual([]);
  expect(analyzePixels(snapped, [gameBoy], changes).warnings.some((w) => w.startsWith("PALETTE: 2 off-palette entries were snapped"))).toBe(true);
});

test("Endesga 32, NES and 1-bit are recognised and hue-shifted ramps stay inside a palette", async () => {
  const { namedPalettes, palettePromptText, hueShiftedRamp, paletteRamps, pixelPalettes } = await import("./pixel-palettes");
  expect(namedPalettes("Endesga 32 colors").map((p) => p.id)).toEqual(["endesga32"]);
  expect(namedPalettes("use EDG32").map((p) => p.id)).toEqual(["endesga32"]);
  expect(namedPalettes("NES palette, 1-bit icons").map((p) => p.id)).toEqual(["nes", "1bit"]);
  expect(namedPalettes("a 16-bit era look")).toEqual([]);
  expect(palettePromptText(namedPalettes("endesga 32"))).toContain("Shading ramps inside Endesga 32");

  const value = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
  const free = hueShiftedRamp("#e43b44", 4);
  expect(free).toHaveLength(4);
  expect(free.map(value)).toEqual([...free.map(value)].sort((a, b) => a - b)); // dark to light
  const blue = (hex: string) => parseInt(hex.slice(5, 7), 16) - parseInt(hex.slice(3, 5), 16);
  expect(blue(free[0]) / value(free[0])).toBeGreaterThan(blue("#e43b44") / value("#e43b44")); // shadows lean blue
  const endesga = pixelPalettes.endesga32.colors;
  const snapped = hueShiftedRamp("#e43b44", 5, { palette: endesga });
  expect(snapped.every((color) => endesga.includes(color))).toBe(true);
  expect(new Set(snapped).size).toBe(snapped.length);
  const ramps = paletteRamps(endesga);
  expect(ramps.length).toBeGreaterThan(2);
  expect(ramps.flat().every((color) => endesga.includes(color))).toBe(true);
  expect(paletteRamps(pixelPalettes["1bit"].colors)).toEqual([]);
});

// ---- patches, frames and layers ---------------------------------------------------------------------------------

test("a revision can patch rectangles of the previous drawing instead of redrawing it", async () => {
  const { resolvePixelAnswer, pixelGridSchema } = await import("./pixel");
  const answer = (patches: object[], extra: object = {}) =>
    pixelGridSchema.parse({ width: 4, height: 4, palette: heart.palette, patches, ...extra });
  expect(resolvePixelAnswer(answer([{ row: 2, column: 2, rows: ["hh"] }]), heart).rows).toEqual(["....", ".hh.", "ohho", "o..o"]);
  expect(resolvePixelAnswer(answer([{ row: 1, rows: ["oooo", "hhhh"] }]), heart).rows).toEqual(["oooo", "hhhh", "ohho", "o..o"]);
  expect(heart.rows[1]).toBe(".oo."); // the previous drawing is not modified
  // A new palette key may be used in a patch.
  const recolored = resolvePixelAnswer(answer([{ row: 3, column: 2, rows: ["zz"] }], { palette: [...heart.palette, { key: "z", color: "#ff8800" }] }), heart);
  expect(validatePixelGrid(recolored).keys.slice(8, 12).join("")).toBe("ozzo");

  expect(() => resolvePixelAnswer(answer([{ row: 4, rows: ["oooo", "oooo"] }]), heart)).toThrow("Patch 1: rows 4-5 run past the last row (4)");
  expect(() => resolvePixelAnswer(answer([{ row: 1, column: 3, rows: ["ooo"] }]), heart)).toThrow("columns 3-5 run past the last column");
  expect(() => resolvePixelAnswer(answer([{ row: 1, rows: ["oo", "o"] }]), heart)).toThrow("same length");
  expect(() => resolvePixelAnswer(answer([{ row: 1, rows: ["oo"] }]))).toThrow("need a previous drawing");
  expect(() => resolvePixelAnswer(answer([{ row: 1, rows: ["oo"] }], { rows: heart.rows }), heart)).toThrow("not both");
  expect(() => resolvePixelAnswer(pixelGridSchema.parse({ width: 8, height: 4, palette: heart.palette, patches: [{ row: 1, rows: ["o"] }] }), heart)).toThrow("cannot resize");
  expect(() => resolvePixelAnswer(answer([{ target: "frame 3", row: 1, rows: ["o"] }]), heart)).toThrow('target "frame 3" is not a frame or layer');
  expect(() => resolvePixelAnswer(pixelGridSchema.parse({ width: 4, height: 4, palette: heart.palette }))).toThrow("no `rows`");

  const animated: PixelGrid = { ...heart, frames: [{ rows: ["....", ".oo.", "ohho", "oooo"] }] };
  expect(resolvePixelAnswer(answer([{ target: "frame 2", row: 4, rows: ["hhhh"] }]), animated).frames?.[0].rows[3]).toBe("hhhh");
  const doll: PixelGrid = { ...heart, layers: [{ name: "hat", rows: ["hhhh", "....", "....", "...."] }] };
  expect(resolvePixelAnswer(answer([{ target: "hat", row: 1, rows: ["oo"] }]), doll).layers?.[0].rows[0]).toBe("oohh");
});

test("animation frames and paperdoll layers share one grid and palette", () => {
  const frames: PixelGrid = { ...heart, frames: [{ rows: ["....", ".oo.", "ohho", "oooo"] }], fps: 6, loop: true };
  expect(validatePixelGrid(frames).frames).toHaveLength(2);
  expect(() => validatePixelGrid({ ...frames, frames: [{ rows: ["....", ".oo.", "ohh", "oooo"] }] })).toThrow("Frame 2: Row 3 has 3 cells; expected 4");
  expect(() => validatePixelGrid({ ...heart, frames: [{ rows: heart.rows }], layers: [{ name: "hat", rows: heart.rows }] })).toThrow("not both");

  const doll: PixelGrid = { ...heart, layers: [{ name: "hat", rows: ["hhhh", "....", "....", "...."] }], anchors: [{ name: "grip", x: 3, y: 2 }] };
  const checked = validatePixelGrid(doll);
  expect(checked.layers.map((layer) => layer.name)).toEqual(["base", "hat"]);
  expect([...checked.rgba.subarray(0, 4)]).toEqual([0xff, 0xd0, 0x60, 255]); // the hat is composited over the base
  expect(() => validatePixelGrid({ ...doll, layers: [{ name: "base", rows: heart.rows }] })).toThrow('Layer name "base" is used twice');
  expect(() => validatePixelGrid({ ...doll, anchors: [{ name: "feet", x: 4, y: 0 }] })).toThrow('Anchor "feet" (4, 0) lies outside');
  expect(analyzePixels(doll).layers?.map((layer) => [layer.name, layer.cells])).toEqual([["base", 8], ["hat", 4]]);
});

test("frames are linted for repeats, a popping loop and an unstable silhouette", () => {
  const box = (x0: number, w = 4) => fill(16, (x, y) => (x >= x0 && x < x0 + w && y >= 8 ? (x === x0 ? "a" : "c") : "."));
  const still = analyzePixels({ ...grid(box(2), four), frames: [{ rows: box(2) }] });
  expect(still.animation?.changeBetweenFrames).toEqual([0]);
  expect(still.warnings).toContain("FRAMES: frame 2 repeats frame 1 exactly; drop it or move something");

  const repeatLoop = analyzePixels({ ...grid(box(2), four), frames: [{ rows: box(3) }, { rows: box(2) }] });
  expect(repeatLoop.warnings.some((w) => w.startsWith("LOOP: the last frame repeats the first"))).toBe(true);

  // Small steps one way, then one big jump back: the loop pops, and the silhouette barely overlaps at the seam.
  const drift = analyzePixels({ ...grid(box(0, 6), four), frames: [1, 2, 3, 4, 5, 6].map((x) => ({ rows: box(x, 6) })) });
  expect(drift.animation?.loopSeamChange).toBeGreaterThan(0.5);
  expect(drift.warnings.some((w) => w.startsWith("LOOP: going from frame 7 back to frame 1"))).toBe(true);
  expect(drift.warnings.some((w) => w.startsWith("SILHOUETTE:") && w.includes("(the loop)"))).toBe(true);
  expect(analyzePixels({ ...grid(box(0, 6), four), frames: [1, 2, 3].map((x) => ({ rows: box(x, 6) })), loop: false }).animation).not.toHaveProperty("loopSeamChange");
});

test("a saved version 1 grid (a still image without a format number) still validates and renders", async () => {
  const { pixelGridSchema, resolvePixelAnswer } = await import("./pixel");
  const saved = JSON.parse(JSON.stringify({ width: 4, height: 4, palette: heart.palette, rows: heart.rows }));
  const parsed = resolvePixelAnswer(pixelGridSchema.parse({ plan: "an old run result", ...saved }));
  expect(validatePixelGrid(parsed).frames).toHaveLength(1);
  const rendered = await renderPixels(saved);
  expect(rendered.files.map((file) => file.name)).toEqual(["sheet.png", "sheet.json", "sheet.unity.json", "sheet.godot.json"]);
  expect((await sharp(rendered.native).metadata()).width).toBe(4);
});

test("an animation renders a looping GIF and a paperdoll one PNG per layer with their anchors", async () => {
  const animated = await renderPixels({ ...heart, frames: [{ rows: ["....", ".oo.", "ohho", "oooo"] }], fps: 5, loop: true });
  const gif = animated.files.find((file) => file.name === "anim.gif")!;
  const meta = await sharp(gif.data as Buffer, { animated: true }).metadata();
  expect([meta.pages, meta.loop, meta.delay]).toEqual([2, 0, [200, 200]]);
  expect(JSON.parse(animated.files.find((file) => file.name === "sheet.json")!.data as string).cells).toHaveLength(2);

  const doll = await renderPixels({ ...heart, layers: [{ name: "Hat & Brim", rows: ["hhhh", "....", "....", "...."] }], anchors: [{ name: "grip", x: 3, y: 2 }] });
  expect(doll.files.map((file) => file.name)).toContain("layer-01-hat-brim.png");
  const layers = JSON.parse(doll.files.find((file) => file.name === "layers.json")!.data as string);
  expect(layers).toMatchObject({ layers: [{ name: "base", z: 0 }, { name: "Hat & Brim", z: 1, file: "layer-01-hat-brim.png" }], anchors: [{ name: "grip", x: 3, y: 2 }] });
});

test("the review sheet shows the art zoomed on mid grey with exact cell colors", async () => {
  const { reviewSheet } = await import("./pixel-render.server");
  const sheet = await sharp(await reviewSheet(heart)).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => [...sheet.data.subarray((y * sheet.info.width + x) * 4, (y * sheet.info.width + x) * 4 + 3)];
  // Zoom 12x starts at (34, 50): cell (column 2, row 2) is "o", cell (1, 1) is transparent.
  expect(at(34 + 12 + 6, 50 + 12 + 6)).toEqual([0x10, 0x20, 0x30]);
  expect(at(34 + 6, 50 + 6)).toEqual([58, 60, 66]);
  expect(sheet.info.width).toBeGreaterThan(250);
});
