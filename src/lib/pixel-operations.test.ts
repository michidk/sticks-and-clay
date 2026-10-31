import { expect, test } from "bun:test";
import { pixelGridSchema, resolvePixelAnswer, validatePixelGrid } from "./pixel";

const base = { width: 4, height: 4, palette: [{ key: ".", color: "transparent" }, { key: "x", color: "#123456" }] };
const resolve = (operations: unknown[], extra = {}) => resolvePixelAnswer(pixelGridSchema.parse({ ...base, ...extra, operations }));

test("ordered shapes produce exact cells and a valid palette-locked drawing", () => {
  const grid = resolve([
    { kind: "rectangle", key: "x", x: 0, y: 0, width: 2, height: 4 },
    { kind: "line", key: ".", from: { x: 0, y: 0 }, to: { x: 3, y: 3 } },
  ]);
  expect(grid.rows).toEqual([".x..", "x...", "xx..", "xx.."]);
  expect(validatePixelGrid(grid).rgba.slice(4, 8)).toEqual(new Uint8Array([18, 52, 86, 255]));
  expect(grid).not.toHaveProperty("operations");
});

test("ellipses and polygons rasterize without antialiasing", () => {
  expect(resolve([{ kind: "ellipse", key: "x", x: 0, y: 0, width: 4, height: 4 }]).rows).toEqual([".xx.", "xxxx", "xxxx", ".xx."]);
  expect(resolve([{ kind: "polygon", key: "x", points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 3 }] }]).rows).toEqual(["xxxx", "xxx.", "xx..", "x..."]);
});

test("local operations preserve the previous drawing and target frames independently", () => {
  const previous = { ...base, rows: ["x...", "....", "....", "...."], frames: [{ rows: ["....", "....", "....", "...x"] }] };
  const grid = resolvePixelAnswer(pixelGridSchema.parse({ ...base, operations: [{ kind: "line", key: "x", target: "frame 2", from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }] }), previous);
  expect(grid.rows).toEqual(previous.rows);
  expect(grid.frames?.[0].rows).toEqual(["xx..", "....", "....", "...x"]);
  expect(previous.frames[0].rows[0]).toBe("....");
});

test("invalid operations fail instead of cropping, resizing or inventing colors", () => {
  expect(() => resolve([{ kind: "rectangle", key: "x", x: 3, y: 0, width: 2, height: 1 }])).toThrow("bounds");
  expect(() => resolve([{ kind: "line", key: "z", from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }])).toThrow("palette");
  expect(() => resolve([{ kind: "line", key: "x", target: "missing", from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }])).toThrow("target");
});


test("provider null targets and omitted saved targets both draw on the base", () => {
  const shape = { kind: "rectangle", key: "x", x: 1, y: 1, width: 2, height: 2 };
  const expected = ["....", ".xx.", ".xx.", "...."];
  expect(resolve([shape]).rows).toEqual(expected);
  expect(resolve([{ ...shape, target: null }]).rows).toEqual(expected);
});
