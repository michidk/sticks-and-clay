import { z } from "zod";
import { MAX_PIXELS, PixelGridError, type PixelGrid } from "./pixel";

const MAX_ROW_REPAIRS = MAX_PIXELS;
export const pixelRowRepairSchema = z.object({
  corrections: z.array(z.object({
    target: z.number().int().min(0).max(9),
    row: z.number().int().min(1).max(MAX_PIXELS),
    cells: z.string().min(4).max(MAX_PIXELS),
  })).min(1).max(MAX_ROW_REPAIRS),
});

const targets = (grid: PixelGrid) => [
  { label: grid.frames?.length ? "frame 1" : "base", rows: grid.rows },
  ...(grid.frames ?? []).map((frame, i) => ({ label: `frame ${i + 2}`, rows: frame.rows })),
  ...(grid.layers ?? []).map((layer) => ({ label: `layer ${JSON.stringify(layer.name)}`, rows: layer.rows })),
];

/** Repair only a small set of malformed rows; whole-grid errors use the existing redraw retry. */
export function pixelRowProblems(grid: PixelGrid) {
  if (grid.frames?.length && grid.layers?.length) return [];
  const planes = targets(grid);
  if (planes.some(({ rows }) => rows.length !== grid.height)) return [];
  const keys = new Set(grid.palette.map(({ key }) => key));
  const problems = planes.flatMap(({ label, rows }, target) => rows.flatMap((cells, index) => {
    const actualWidth = [...cells].length;
    const invalidCells = [...cells].flatMap((key, column) => keys.has(key) ? [] : [{ column: column + 1, key }]);
    return actualWidth === grid.width && !invalidCells.length ? [] : [{
      target, label, row: index + 1, cells, actualWidth, expectedWidth: grid.width, invalidCells,
    }];
  }));
  return problems.length <= MAX_ROW_REPAIRS ? problems : [];
}

/** Full-row replacement preserves all other cells, the palette, dimensions and animation/layer metadata. */
export function correctPixelRows(grid: PixelGrid, repair: z.infer<typeof pixelRowRepairSchema>): PixelGrid {
  const problems = pixelRowProblems(grid);
  const pending = new Set(problems.map(({ target, row }) => `${target}:${row}`));
  if (!pending.size) throw new PixelGridError("No eligible malformed rows to repair");
  const corrected = {
    ...grid,
    rows: [...grid.rows],
    frames: grid.frames?.map(frame => ({ ...frame, rows: [...frame.rows] })),
    layers: grid.layers?.map(layer => ({ ...layer, rows: [...layer.rows] })),
  };
  const planes = targets(corrected);
  const keys = new Set(grid.palette.map(({ key }) => key));
  for (const { target, row, cells } of repair.corrections) {
    if (!pending.delete(`${target}:${row}`))
      throw new PixelGridError(`Row repair targets an unrequested or repeated row: target ${target}, row ${row}`);
    if ([...cells].length !== grid.width || [...cells].some(key => !keys.has(key)))
      throw new PixelGridError(`Row repair target ${target}, row ${row} must have exactly ${grid.width} cells using only palette keys`);
    planes[target].rows[row - 1] = cells;
  }
  if (pending.size) throw new PixelGridError("Row repair omitted requested malformed rows");
  return corrected;
}
