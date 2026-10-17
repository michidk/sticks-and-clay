import { z } from "zod";

export const MAX_PIXELS = 128;
export const MAX_COLORS = 32;

/** What the model draws: a palette and one string per row, one character per cell. A list rather than a
 * map, so the structured-output schema stays strict. */
export const pixelGridSchema = z.object({
  plan: z.string().max(4000).optional(),
  width: z.number().int().min(4).max(MAX_PIXELS),
  height: z.number().int().min(4).max(MAX_PIXELS),
  palette: z.array(z.object({ key: z.string().length(1), color: z.string().max(11) })).min(1).max(MAX_COLORS),
  rows: z.array(z.string().max(MAX_PIXELS)).min(4).max(MAX_PIXELS),
});
export type PixelGrid = z.infer<typeof pixelGridSchema>;

const COLOR = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

/** Colors as RGBA bytes; "transparent" is a fully clear cell. */
function parseColor(color: string): [number, number, number, number] {
  if (color.toLowerCase() === "transparent") return [0, 0, 0, 0];
  const match = COLOR.exec(color);
  if (!match) throw new Error(`Palette color "${color}" must be #rrggbb, #rrggbbaa or "transparent"`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, match[2] ? parseInt(match[2], 16) : 255];
}

/** Checks the drawing and returns its cells; the message names the first problem so a retry can fix it. */
export function validatePixelGrid(grid: PixelGrid) {
  const colors = new Map<string, [number, number, number, number]>();
  for (const { key, color } of grid.palette) {
    if (/\s/.test(key)) throw new Error("Palette keys cannot be whitespace");
    if (colors.has(key)) throw new Error(`Palette key "${key}" is defined twice`);
    colors.set(key, parseColor(color));
  }
  if (grid.rows.length !== grid.height) throw new Error(`Expected ${grid.height} rows, got ${grid.rows.length}`);
  const rgba = new Uint8Array(grid.width * grid.height * 4);
  const keys: string[] = [];
  grid.rows.forEach((row, y) => {
    const cells = [...row];
    if (cells.length !== grid.width) throw new Error(`Row ${y + 1} has ${cells.length} cells; expected ${grid.width}`);
    cells.forEach((key, x) => {
      const color = colors.get(key);
      if (!color) throw new Error(`Row ${y + 1}, column ${x + 1}: "${key}" is not in the palette`);
      rgba.set(color, (y * grid.width + x) * 4);
      keys.push(key);
    });
  });
  return { width: grid.width, height: grid.height, rgba, keys };
}

/** Measurements for the reviewer, in cells: palette use, how the art sits on the grid, and stray single cells. */
export function analyzePixels(grid: PixelGrid) {
  const { width, height, rgba, keys } = validatePixelGrid(grid);
  const used = new Map<string, number>();
  let left = width, right = -1, top = height, bottom = -1, inked = 0, orphans = 0;
  keys.forEach((key, i) => {
    used.set(key, (used.get(key) ?? 0) + 1);
    const x = i % width, y = Math.floor(i / width);
    if (rgba[i * 4 + 3] > 8) {
      inked++;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      const same = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < width && ny < height && keys[ny * width + nx] === key;
      });
      if (!same) orphans++; // a lone cell with no same-colored neighbour: noise, unless it is a deliberate highlight
    }
  });
  const color = new Map(grid.palette.map((entry) => [entry.key, entry.color]));
  return {
    size: `${width}x${height}`,
    colorsUsed: [...used.keys()].filter((key) => (color.get(key) ?? "").toLowerCase() !== "transparent").length,
    paletteEntriesUnused: grid.palette.filter((entry) => !used.has(entry.key)).map((entry) => entry.key),
    usage: [...used].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, cells]) => ({ key, color: color.get(key), cells })),
    transparentShare: Math.round((1 - inked / (width * height)) * 1000) / 1000,
    isolatedCells: orphans,
    ...(inked
      ? {
          marginsInCells: { left, top, right: width - 1 - right, bottom: height - 1 - bottom },
          touchesEdge: [
            ...(left === 0 ? ["left"] : []), ...(top === 0 ? ["top"] : []),
            ...(right === width - 1 ? ["right"] : []), ...(bottom === height - 1 ? ["bottom"] : []),
          ],
        }
      : { empty: true }),
  };
}
