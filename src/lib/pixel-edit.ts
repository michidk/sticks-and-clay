import { z } from "zod";
import { PixelGridError, validatePixelGrid, type PixelGrid } from "./pixel";

export const pixelEditInput = z.strictObject({
  sourceRunId: z.string().uuid(),
  edits: z.array(z.strictObject({
    x: z.number().int().min(0).max(127), y: z.number().int().min(0).max(127),
    key: z.string().length(1), target: z.string().max(40).default("base"),
  })).min(1).max(16384),
});

export function editPixelCanvas(grid: PixelGrid, edits: z.infer<typeof pixelEditInput>["edits"]) {
  const base = grid.rows.map(row => [...row]);
  const frames = grid.frames?.map(frame => frame.rows.map(row => [...row]));
  const layers = grid.layers?.map(layer => ({ ...layer, cells: layer.rows.map(row => [...row]) }));
  const keys = new Set(grid.palette.map(color => color.key));
  for (const edit of edits) {
    if (!keys.has(edit.key)) throw new PixelGridError("Choose a color from the saved palette");
    const frame = /^frame (\d+)$/.exec(edit.target);
    const rows = edit.target === "base" ? base : frame ? frames?.[Number(frame[1]) - 2] : layers?.find(layer => layer.name === edit.target)?.cells;
    if (!rows) throw new PixelGridError("Choose an existing frame or layer");
    if (edit.x < 0 || edit.y < 0 || edit.x >= grid.width || edit.y >= grid.height)
      throw new PixelGridError("Pixel edit is outside the canvas");
    rows[edit.y][edit.x] = edit.key;
  }
  const result = {
    ...grid, rows: base.map(row => row.join("")),
    frames: frames?.map(rows => ({ rows: rows.map(row => row.join("")) })),
    layers: layers?.map(({ cells, ...layer }) => ({ ...layer, rows: cells.map(row => row.join("")) })),
  };
  validatePixelGrid(result);
  return result;
}
