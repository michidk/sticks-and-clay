import { expect, test } from "bun:test";
import { correctPixelRows, pixelRowProblems } from "./pixel-row-repair";
import { validatePixelGrid, type PixelGrid } from "./pixel";

const drawing = (): PixelGrid => ({
  width: 32, height: 32,
  palette: [{ key: ".", color: "transparent" }, { key: "o", color: "#284e3c" }],
  rows: Array.from({ length: 32 }, () => ".".repeat(32)),
});

test("repairs the farmhouse's undefined space and TV's 33-cell row without changing other cells", () => {
  const grid = drawing();
  grid.rows[4] = ".".repeat(16) + " " + ".".repeat(15);
  grid.rows[23] = ".".repeat(15) + "ooo" + ".".repeat(15);
  expect(() => validatePixelGrid(grid)).toThrow('Row 5, column 17: " " is not in the palette');
  expect(pixelRowProblems(grid)).toEqual([
    { target: 0, label: "base", row: 5, cells: grid.rows[4], actualWidth: 32, expectedWidth: 32, invalidCells: [{ column: 17, key: " " }] },
    { target: 0, label: "base", row: 24, cells: grid.rows[23], actualWidth: 33, expectedWidth: 32, invalidCells: [] },
  ]);
  const corrected = correctPixelRows(grid, { corrections: [
    { target: 0, row: 5, cells: ".".repeat(16) + "o" + ".".repeat(15) },
    { target: 0, row: 24, cells: ".".repeat(15) + "oo" + ".".repeat(15) },
  ] });
  expect(() => validatePixelGrid(corrected)).not.toThrow();
  expect(corrected.rows[4][16]).toBe("o");
  expect(corrected.rows[23]).toBe("...............oo...............");
  expect(corrected.rows.filter((_, i) => i !== 4 && i !== 23)).toEqual(grid.rows.filter((_, i) => i !== 4 && i !== 23));
  expect(grid.rows[4][16]).toBe(" ");
  expect(grid.rows[23]).toHaveLength(33);
});

test("refuses guessed, missing, duplicate or unrelated corrections", () => {
  const grid = drawing(); grid.rows[4] = "short";
  for (const corrections of [
    [],
    [{ target: 0, row: 6, cells: ".".repeat(32) }],
    [{ target: 0, row: 5, cells: " ".repeat(32) }],
    [{ target: 0, row: 5, cells: ".".repeat(33) }],
    [{ target: 0, row: 5, cells: ".".repeat(32) }, { target: 0, row: 5, cells: ".".repeat(32) }],
  ]) expect(() => correctPixelRows(grid, { corrections })).toThrow();
  expect(grid.rows[4]).toBe("short");
});

test("uses explicit targets for animation and layers while preserving metadata", () => {
  for (const kind of ["frames", "layers"] as const) {
    const grid = drawing();
    const rows = [...grid.rows]; rows[2] = "bad";
    if (kind === "frames") { grid.frames = [{ rows }]; grid.fps = 8; grid.loop = true; }
    else { grid.layers = [{ name: "frame 1", rows }]; grid.anchors = [{ name: "grip", x: 4, y: 7 }]; }
    const fixed = correctPixelRows(grid, { corrections: [{ target: 1, row: 3, cells: "o".repeat(32) }] });
    expect(fixed.rows).toEqual(grid.rows);
    expect((fixed.frames ?? fixed.layers)?.[0].rows[2]).toBe("o".repeat(32));
    expect(fixed.fps).toBe(grid.fps); expect(fixed.anchors).toEqual(grid.anchors);
    expect(() => validatePixelGrid(fixed)).not.toThrow();
  }
});

test("repairs 33 malformed rows on a 96 by 48 canvas without redrawing valid rows", () => {
  const valid = ".".repeat(96);
  const grid: PixelGrid = {
    ...drawing(), width: 96, height: 48,
    rows: Array.from({ length: 48 }, (_, i) => i < 33 ? "o".repeat(95) : valid),
  };
  expect(pixelRowProblems(grid)).toHaveLength(33);
  const repaired = correctPixelRows(grid, { corrections: Array.from({ length: 33 }, (_, i) => ({
    target: 0, row: i + 1, cells: "o".repeat(96),
  })) });
  expect(() => validatePixelGrid(repaired)).not.toThrow();
  expect(repaired.rows.slice(33)).toEqual(Array(15).fill(valid));
  expect(grid.rows[0]).toHaveLength(95);
});

test("whole-grid errors and oversized multi-plane repairs use the full-answer retry", () => {
  const grid = drawing(); grid.rows.pop();
  expect(pixelRowProblems(grid)).toEqual([]);
  const rows = Array.from({ length: 128 }, () => "bad");
  const large = { ...drawing(), height: 128, rows, frames: [{ rows }] };
  expect(pixelRowProblems(large)).toEqual([]);
});
