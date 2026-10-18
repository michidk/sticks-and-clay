import { z } from "zod";
import { nearestColor, rgbToHex } from "./pixel-palettes";

export const MAX_PIXELS = 128;
export const MAX_COLORS = 32;
/** Frames of one animation, including the first. */
export const MAX_FRAMES = 8;
/** Paperdoll layers, including the base layer. */
export const MAX_LAYERS = 10;
/** Saved grids record this number. Version 1 grids (a still image: width, height, palette and rows) carry none and
 * remain valid: every field version 2 added is optional. */
export const PIXEL_FORMAT = 2;
/** RGB distance under which two palette colors read as the same. */
const NEAR_COLOR = 30;

const row = z.string().max(MAX_PIXELS);
const cells = z.array(row).min(4).max(MAX_PIXELS);
const name = z.string().trim().min(1).max(40);

/** What the model draws: a palette and one string per row, one character per cell. Lists rather than maps, so the
 * structured-output schema stays strict. A still image is `rows`. An animation adds `frames` (the frames after the
 * first, which is `rows`), a paperdoll adds `layers` stacked over `rows` (the base layer). A revision may instead
 * return `patches` that replace rectangles of the previous drawing; `resolvePixelAnswer` turns either into a whole
 * drawing. */
export const pixelGridSchema = z.object({
  plan: z.string().max(4000).optional(),
  width: z.number().int().min(4).max(MAX_PIXELS),
  height: z.number().int().min(4).max(MAX_PIXELS),
  palette: z.array(z.object({ key: z.string().length(1), color: z.string().max(11) })).min(1).max(MAX_COLORS),
  rows: cells.optional(),
  frames: z.array(z.object({ rows: cells })).max(MAX_FRAMES - 1).optional(),
  fps: z.number().int().min(1).max(30).optional(),
  loop: z.boolean().optional(),
  layers: z.array(z.object({ name, rows: cells })).max(MAX_LAYERS - 1).optional(),
  anchors: z.array(z.object({ name, x: z.number().int().min(0).max(MAX_PIXELS - 1), y: z.number().int().min(0).max(MAX_PIXELS - 1) })).max(16).optional(),
  patches: z.array(z.object({
    target: z.string().max(40).optional(),
    row: z.number().int().min(1).max(MAX_PIXELS),
    column: z.number().int().min(1).max(MAX_PIXELS).optional(),
    rows: z.array(row).min(1).max(MAX_PIXELS),
  })).max(64).optional(),
});
export type PixelAnswer = z.infer<typeof pixelGridSchema>;
/** A whole drawing: what is saved as grid.json and rendered. */
export type PixelGrid = Omit<PixelAnswer, "rows" | "patches"> & { rows: string[]; version?: number };

const COLOR = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

/** A drawing the app cannot render; the message names the first problem so a retry can fix it. */
export class PixelGridError extends Error {}
/** A drawing that uses colors outside the named palette the brief asks for. */
export class PixelPaletteError extends PixelGridError {}

type Rgba = [number, number, number, number];
export type PixelImage = { width: number; height: number; rgba: Uint8Array };

/** Colors as RGBA bytes; "transparent" is a fully clear cell. */
function parseColor(color: string): Rgba {
  if (color.toLowerCase() === "transparent") return [0, 0, 0, 0];
  const match = COLOR.exec(color);
  if (!match) throw new PixelGridError(`Palette color "${color}" must be #rrggbb, #rrggbbaa or "transparent"`);
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, match[2] ? parseInt(match[2], 16) : 255];
}

/** Turns a model answer into a whole drawing. Patches apply to `previous`, the drawing being revised: each replaces
 * a rectangle starting at 1-based `row` and `column` (default 1) of the base rows, of `"frame N"`, or of a named
 * layer. Size changes need a whole drawing. The answer's palette, fps, loop and anchors replace the previous ones
 * when given. */
export function resolvePixelAnswer(answer: PixelAnswer, previous?: PixelGrid): PixelGrid {
  const { patches, ...rest } = answer;
  if (!patches?.length) {
    if (!rest.rows) throw new PixelGridError("The answer has no `rows`; return the whole drawing in `rows`");
    return { ...rest, rows: rest.rows };
  }
  if (!previous) throw new PixelGridError("`patches` need a previous drawing; return the whole drawing in `rows` instead");
  if (rest.rows || rest.frames || rest.layers)
    throw new PixelGridError("Return either `patches` against the previous drawing or a whole drawing in `rows`, not both");
  if (answer.width !== previous.width || answer.height !== previous.height)
    throw new PixelGridError(`Patches cannot resize the drawing (${previous.width}x${previous.height}); return the whole drawing to change its size`);
  const grid: PixelGrid = {
    ...previous,
    plan: answer.plan,
    palette: answer.palette,
    rows: [...previous.rows],
    frames: previous.frames?.map((frame) => ({ rows: [...frame.rows] })),
    layers: previous.layers?.map((layer) => ({ ...layer, rows: [...layer.rows] })),
    fps: answer.fps ?? previous.fps,
    loop: answer.loop ?? previous.loop,
    anchors: answer.anchors ?? previous.anchors,
  };
  patches.forEach((patch, index) => {
    const label = `Patch ${index + 1}`;
    const target = (patch.target ?? "").trim();
    const frame = /^frame\s*(\d+)$/i.exec(target);
    let rows: string[] | undefined;
    if (!target || /^(base|rows)$/i.test(target) || (frame && Number(frame[1]) === 1)) rows = grid.rows;
    else if (frame) rows = grid.frames?.[Number(frame[1]) - 2]?.rows;
    else rows = grid.layers?.find((layer) => layer.name === target)?.rows;
    if (!rows) throw new PixelGridError(`${label}: target "${target}" is not a frame or layer of the previous drawing`);
    const column = patch.column ?? 1;
    const width = [...patch.rows[0]].length;
    if (patch.rows.some((line) => [...line].length !== width))
      throw new PixelGridError(`${label}: every patch row must have the same length (${width} cells)`);
    if (patch.row - 1 + patch.rows.length > grid.height)
      throw new PixelGridError(`${label}: rows ${patch.row}-${patch.row + patch.rows.length - 1} run past the last row (${grid.height})`);
    if (column - 1 + width > grid.width)
      throw new PixelGridError(`${label}: columns ${column}-${column + width - 1} run past the last column (${grid.width})`);
    patch.rows.forEach((line, offset) => {
      const y = patch.row - 1 + offset;
      const cellsOf = [...rows[y]];
      if (cellsOf.length !== grid.width)
        throw new PixelGridError(`${label}: the previous drawing's row ${y + 1} is malformed; return the whole drawing`);
      cellsOf.splice(column - 1, width, ...line);
      rows[y] = cellsOf.join("");
    });
  });
  return grid;
}

function readRows(rows: string[], grid: PixelGrid, colors: Map<string, Rgba>, label: string) {
  if (rows.length !== grid.height) throw new PixelGridError(`${label}Expected ${grid.height} rows, got ${rows.length}`);
  const rgba = new Uint8Array(grid.width * grid.height * 4);
  const keys: string[] = [];
  rows.forEach((line, y) => {
    const cellsOf = [...line];
    if (cellsOf.length !== grid.width) throw new PixelGridError(`${label}Row ${y + 1} has ${cellsOf.length} cells; expected ${grid.width}`);
    cellsOf.forEach((key, x) => {
      const color = colors.get(key);
      if (!color) throw new PixelGridError(`${label}Row ${y + 1}, column ${x + 1}: "${key}" is not in the palette`);
      rgba.set(color, (y * grid.width + x) * 4);
      keys.push(key);
    });
  });
  return { rgba, keys };
}

/** Straight-alpha "over": `top` drawn onto `bottom`. */
function composite(bottom: Uint8Array, top: Uint8Array) {
  const out = new Uint8Array(bottom);
  for (let i = 0; i < out.length; i += 4) {
    const a = top[i + 3] / 255, b = out[i + 3] / 255, alpha = a + b * (1 - a);
    if (!a) continue;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round((top[i + c] * a + out[i + c] * b * (1 - a)) / alpha);
    out[i + 3] = Math.round(alpha * 255);
  }
  return out;
}

/** Checks the drawing and returns its cells; the message names the first problem so a retry can fix it. `rgba` and
 * `keys` are the still image: the first frame of an animation, or a paperdoll's layers composited. */
export function validatePixelGrid(grid: PixelGrid) {
  const colors = new Map<string, Rgba>();
  for (const { key, color } of grid.palette) {
    if (/\s/.test(key)) throw new PixelGridError("Palette keys cannot be whitespace");
    if (colors.has(key)) throw new PixelGridError(`Palette key "${key}" is defined twice`);
    colors.set(key, parseColor(color));
  }
  if (grid.frames?.length && grid.layers?.length)
    throw new PixelGridError("A drawing has either animation `frames` or paperdoll `layers`, not both");
  const base = readRows(grid.rows, grid, colors, grid.frames?.length ? "Frame 1: " : "");
  const frames = [base, ...(grid.frames ?? []).map((frame, i) => readRows(frame.rows, grid, colors, `Frame ${i + 2}: `))];
  const names = new Set<string>(["base"]);
  const layers = [{ name: "base", ...base }];
  for (const layer of grid.layers ?? []) {
    if (names.has(layer.name)) throw new PixelGridError(`Layer name "${layer.name}" is used twice (the first layer is "base")`);
    names.add(layer.name);
    layers.push({ name: layer.name, ...readRows(layer.rows, grid, colors, `Layer "${layer.name}": `) });
  }
  for (const anchor of grid.anchors ?? [])
    if (anchor.x >= grid.width || anchor.y >= grid.height)
      throw new PixelGridError(`Anchor "${anchor.name}" (${anchor.x}, ${anchor.y}) lies outside the ${grid.width}x${grid.height} grid`);
  const rgba = layers.length > 1 ? layers.slice(1).reduce((image, layer) => composite(image, layer.rgba), base.rgba) : base.rgba;
  return { width: grid.width, height: grid.height, rgba, keys: base.keys, frames, layers: layers.length > 1 ? layers : [] };
}

// ---- named palettes ------------------------------------------------------------------------------------------------

type Preset = { label?: string; colors: string[] };
const opaqueEntries = (grid: PixelGrid) => {
  const used = new Set([grid.rows, ...(grid.frames ?? []).map((f) => f.rows), ...(grid.layers ?? []).map((l) => l.rows)].flat().flatMap((line) => [...line]));
  return grid.palette.filter((entry) => used.has(entry.key) && parseColor(entry.color)[3] > 0);
};

/** Palette entries the drawing uses whose color is outside every named palette, with the nearest allowed color. */
export function offPaletteEntries(grid: PixelGrid, presets: Preset[]) {
  const allowed = [...new Set(presets.flatMap((preset) => preset.colors.map((hex) => hex.toLowerCase())))];
  if (!allowed.length) return [];
  return opaqueEntries(grid).flatMap(({ key, color }) => {
    const hex = rgbToHex(parseColor(color));
    return allowed.includes(hex) ? [] : [{ key, color: hex, nearest: nearestColor(hex, allowed) }];
  });
}

/** Rejects a drawing that leaves the named palette, naming each wrong key and the closest legal color, so the
 * corrected retry can fix it. */
export function enforcePalette(grid: PixelGrid, presets: Preset[]) {
  const off = offPaletteEntries(grid, presets);
  if (!off.length) return;
  const names = presets.map((preset) => preset.label ?? "named").join(" or ");
  throw new PixelPaletteError(
    `${off.length} palette ${off.length === 1 ? "entry is" : "entries are"} not ${names} colors: `
    + off.slice(0, 8).map((entry) => `"${entry.key}" ${entry.color} (nearest ${entry.nearest})`).join(", ")
    + `. Use only the exact ${names} values`,
  );
}

/** The deterministic fallback when a corrected drawing still leaves the palette: every off-palette entry takes its
 * nearest named color (keeping its alpha), and the substitutions are returned so the review can report them. */
export function snapToPalette(grid: PixelGrid, presets: Preset[]) {
  const off = new Map(offPaletteEntries(grid, presets).map((entry) => [entry.key, entry]));
  const palette = grid.palette.map((entry) => {
    const fix = off.get(entry.key);
    if (!fix) return entry;
    const alpha = COLOR.exec(entry.color)?.[2];
    return { key: entry.key, color: fix.nearest + (alpha && alpha.toLowerCase() !== "ff" ? alpha : "") };
  });
  return { grid: { ...grid, palette }, snapped: [...off.values()].map(({ key, color, nearest }) => ({ key, from: color, to: nearest })) };
}

// ---- craft measurements --------------------------------------------------------------------------------------------

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
/** Perceived brightness 0..1 of a color as stored (sRGB), the way the Values panel shows it. */
const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Colors a canvas of this size can carry before it reads as a filtered or painted image rather than pixel art. */
const colorBudget = (size: number) => (size <= 16 ? 8 : size <= 32 ? 16 : size <= 64 ? 24 : 32);

/** The craft measurements of one image, with a named warning for each threshold crossed. Thresholds follow common
 * pixel-art critique; they support the reviewer's eye rather than replace it. */
export function lintPixels({ width: w, height: h, rgba }: PixelImage, { allowBlack = false } = {}) {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : y * w + x);
  const opaque = (i: number) => i >= 0 && rgba[i * 4 + 3] > 8;
  const same = (i: number, j: number) =>
    j >= 0 && opaque(j) && rgba[i * 4] === rgba[j * 4] && rgba[i * 4 + 1] === rgba[j * 4 + 1] && rgba[i * 4 + 2] === rgba[j * 4 + 2];
  const warnings: string[] = [];
  const inked: number[] = [];
  for (let i = 0; i < w * h; i++) if (opaque(i)) inked.push(i);
  if (!inked.length) return { metrics: { empty: true }, warnings: ["EMPTY: nothing is drawn"] };

  // Edge cells touch transparency or the canvas edge (4-way): the outline and the silhouette.
  const isEdge = new Uint8Array(w * h);
  for (const i of inked) {
    const x = i % w, y = (i - x) / w;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !opaque(at(x + dx, y + dy)))) isEdge[i] = 1;
  }
  const interior = inked.filter((i) => !isEdge[i]);
  const edgeCount = inked.length - interior.length;

  // Noise: interior cells none of whose 8 neighbours shares their color. A single speckled material hides in the
  // average, so the worst 8x8 window is reported too.
  const lone = new Uint8Array(w * h);
  let loneCount = 0;
  for (const i of interior) {
    const x = i % w, y = (i - x) / w;
    let found = false;
    for (let dy = -1; dy <= 1 && !found; dy++) for (let dx = -1; dx <= 1 && !found; dx++) if ((dx || dy) && same(i, at(x + dx, y + dy))) found = true;
    if (!found) { lone[i] = 1; loneCount++; }
  }
  const noise = loneCount / Math.max(1, interior.length);
  let worst = { share: 0, x: 0, y: 0 };
  for (let wy = 0; wy < h; wy += 4) for (let wx = 0; wx < w; wx += 4) {
    let count = 0, speckled = 0;
    for (let y = wy; y < Math.min(h, wy + 8); y++) for (let x = wx; x < Math.min(w, wx + 8); x++) {
      const i = y * w + x;
      if (opaque(i) && !isEdge[i]) { count++; speckled += lone[i]; }
    }
    if (count >= 32 && speckled / count > worst.share) worst = { share: speckled / count, x: wx, y: wy };
  }
  if (interior.length >= 64 && noise > 0.06)
    warnings.push(`NOISE: ${loneCount} interior cells (${Math.round(noise * 100)}%) share their color with none of their 8 neighbours; group shading into clusters of 2x2 and up and keep single cells for deliberate details (eye glints, rivets)`);
  else if (worst.share >= 0.15)
    warnings.push(`NOISE: speckled patch at columns ${worst.x + 1}-${Math.min(w, worst.x + 8)}, rows ${worst.y + 1}-${Math.min(h, worst.y + 8)} (${Math.round(worst.share * 100)}% lone cells); shade that material in clusters instead of scattered single cells`);

  // Near-pure black reads as a hard sticker line; outlines and creases look better in a dark tone of the color they border.
  const black = inked.filter((i) => Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) < 24).length;
  const blackShare = black / inked.length;
  if (!allowBlack && blackShare > 0.08)
    warnings.push(`BLACK: ${Math.round(blackShare * 100)}% of the drawn cells are (near) pure black; use a dark, hue-shifted tone of the bordering color for outlines and creases`);

  // Value range: does the art still read in greyscale? 5th to 95th percentile, so a single glint does not count.
  const values = inked.map((i) => luma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])).sort((a, b) => a - b);
  const valueRange = values[Math.floor(0.95 * (values.length - 1))] - values[Math.floor(0.05 * (values.length - 1))];
  if (valueRange < 0.35)
    warnings.push(`VALUES: the light-to-dark range is only ${round(valueRange)} (of 1, below 0.35); the art turns to mush at 1x. Push the darkest shadows darker and the lit side lighter (see the Values panel)`);

  // Color count against what the canvas size can carry.
  const colors = new Set(inked.map((i) => (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2])).size;
  const budget = colorBudget(Math.max(w, h));
  if (colors > budget)
    warnings.push(`COLORS: ${colors} colors on a ${w}x${h} canvas (about ${budget} at most for this size); use 3 to 4 tones per material and share tones between materials`);
  else if (colors < 4 && inked.length > 200)
    warnings.push(`COLORS: only ${colors} colors over ${inked.length} cells; the forms look flat. Give each material a 3 to 4 step ramp`);

  // A boxy silhouette: long straight outline runs (7 cells and more) along the top and left of shapes read as stacked
  // rectangles rather than drawn forms.
  let straight = 0;
  const countRuns = (outer: number, inner: number, on: (a: number, b: number) => boolean) => {
    for (let a = 0; a < outer; a++) {
      let run = 0;
      for (let b = 0; b <= inner; b++) {
        run = b < inner && on(a, b) ? run + 1 : 0;
        if (run === 7) straight += 7;
        else if (run > 7) straight += 1;
      }
    }
  };
  countRuns(h, w, (y, x) => !!isEdge[y * w + x] && !opaque(at(x, y - 1)));
  countRuns(w, h, (x, y) => !!isEdge[y * w + x] && !opaque(at(x - 1, y)));
  const boxy = straight / Math.max(1, edgeCount);
  if (edgeCount >= 80 && boxy > 0.35)
    warnings.push(`BOXY: ${Math.round(boxy * 100)}% of the outline is straight runs of 7 or more cells; it reads as stacked rectangles. Taper limbs, curve the tops and break long edges with overlaps`);

  // One pixel size: the largest k for which every color run starts and ends on a multiple of k (an upscaled image),
  // and the share of one-cell runs (art drawn at 2x, "mixels", has almost none).
  let scale = 0, singles = 0, runs = 0;
  const color = (i: number) => (opaque(i) ? (rgba[i * 4] * 2 ** 24) + (rgba[i * 4 + 1] << 16) + (rgba[i * 4 + 2] << 8) + rgba[i * 4 + 3] : -1);
  const scanLines = (outer: number, inner: number, index: (a: number, b: number) => number) => {
    for (let a = 0; a < outer; a++) {
      let start = 0;
      for (let b = 1; b <= inner; b++) {
        if (b < inner && color(index(a, b)) === color(index(a, start))) continue;
        scale = gcd(scale, gcd(start, b - start));
        if (opaque(index(a, start))) { runs++; if (b - start === 1) singles++; }
        start = b;
      }
    }
  };
  scanLines(h, w, (y, x) => y * w + x);
  scanLines(w, h, (x, y) => y * w + x);
  const singleRunShare = runs ? singles / runs : 0;
  if (scale >= 2 && runs >= 16)
    warnings.push(`PIXEL SIZE: every cell sits in a ${scale}x${scale} block, so the art is a ${Math.round(w / scale)}x${Math.round(h / scale)} drawing enlarged; draw at the real size`);
  else if (runs >= 20 && singleRunShare < 0.06)
    warnings.push(`PIXEL SIZE: only ${Math.round(singleRunShare * 100)}% of color runs are one cell long; parts look drawn with 2x2 cells (mixed pixel sizes)`);

  return {
    metrics: {
      valueRange: round(valueRange),
      noise: round(noise, 3),
      worstNoisePatch: worst.share ? { columns: `${worst.x + 1}-${Math.min(w, worst.x + 8)}`, rows: `${worst.y + 1}-${Math.min(h, worst.y + 8)}`, loneShare: round(worst.share) } : null,
      loneInteriorCells: loneCount,
      pureBlackShare: round(blackShare, 3),
      colors,
      colorBudgetForSize: budget,
      boxyOutlineShare: round(boxy),
      pixelScale: scale || 1,
      singleCellRunShare: round(singleRunShare, 3),
    },
    warnings,
  };
}

/** Where the drawing sits on its canvas, across all frames: content box (inclusive, 0-based), the gap between the
 * lowest drawn row and the bottom edge, and how far the content's centre is from the canvas centre. Sprites of a set
 * share a baseline and centre so they line up on a tile row. */
export function gridFit(images: PixelImage[]) {
  const { width: w, height: h } = images[0];
  let left = w, right = -1, top = h, bottom = -1;
  for (const { rgba } of images)
    for (let i = 0; i < w * h; i++)
      if (rgba[i * 4 + 3] > 8) {
        const x = i % w, y = (i - x) / w;
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
  if (right < 0) return null;
  return {
    contentBox: { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 },
    baselineGap: h - 1 - bottom,
    centerOffset: round((left + right) / 2 - (w - 1) / 2, 1),
    canvasMultipleOf8: w % 8 === 0 && h % 8 === 0,
  };
}

/** Share of the cells drawn in either image that differ between them. */
function change(a: PixelImage, b: PixelImage) {
  let union = 0, differ = 0;
  for (let i = 0; i < a.rgba.length; i += 4) {
    if (a.rgba[i + 3] <= 8 && b.rgba[i + 3] <= 8) continue;
    union++;
    if (a.rgba[i] !== b.rgba[i] || a.rgba[i + 1] !== b.rgba[i + 1] || a.rgba[i + 2] !== b.rgba[i + 2] || a.rgba[i + 3] !== b.rgba[i + 3]) differ++;
  }
  return union ? differ / union : 0;
}
/** Overlap of two silhouettes: drawn in both / drawn in either. */
function overlap(a: PixelImage, b: PixelImage) {
  let both = 0, either = 0;
  for (let i = 3; i < a.rgba.length; i += 4) {
    const [x, y] = [a.rgba[i] > 8, b.rgba[i] > 8];
    if (x && y) both++;
    if (x || y) either++;
  }
  return either ? both / either : 1;
}

/** Animation checks: each frame's craft, the loop seam (last frame back to the first) and how stable the silhouette
 * stays from frame to frame. */
export function analyzeFrames(images: PixelImage[], { loop = true, allowBlack = false } = {}) {
  const warnings: string[] = [];
  const perFrame = images.map((image, i) => {
    const { metrics, warnings: found } = lintPixels(image, { allowBlack });
    warnings.push(...found.map((warning) => `Frame ${i + 1}: ${warning}`));
    const { valueRange, noise, boxyOutlineShare, singleCellRunShare, colors } = metrics;
    return { frame: i + 1, valueRange, noise, boxyOutlineShare, singleCellRunShare, colors, baselineGap: gridFit([image])?.baselineGap ?? null };
  });
  const steps = images.slice(1).map((image, i) => round(change(images[i], image)));
  const shapes = images.slice(1).map((image, i) => round(overlap(images[i], image)));
  steps.forEach((step, i) => {
    if (step === 0) warnings.push(`FRAMES: frame ${i + 2} repeats frame ${i + 1} exactly; drop it or move something`);
  });
  const average = steps.length ? steps.reduce((a, b) => a + b, 0) / steps.length : 0;
  let seam: number | null = null;
  if (loop && images.length > 2) {
    seam = round(change(images.at(-1)!, images[0]));
    shapes.push(round(overlap(images.at(-1)!, images[0])));
    if (seam === 0) warnings.push("LOOP: the last frame repeats the first; drop it, the loop returns to frame 1 by itself");
    else if (seam > Math.max(0.1, 2 * average))
      warnings.push(`LOOP: going from frame ${images.length} back to frame 1 changes ${Math.round(seam * 100)}% of the drawn cells, ${round(seam / Math.max(average, 0.01), 1)}x the average step (${Math.round(average * 100)}%); the loop pops. Make the last frame lead into the first`);
  }
  const shakiest = shapes.length ? Math.min(...shapes) : 1;
  if (shakiest < 0.55) {
    const at = shapes.indexOf(shakiest);
    const pair = at < steps.length ? `frames ${at + 1} and ${at + 2}` : `frame ${images.length} and frame 1 (the loop)`;
    warnings.push(`SILHOUETTE: only ${Math.round(shakiest * 100)}% of the silhouette overlaps between ${pair}; keep the main mass stable and move secondary parts (hair, cloth, limbs, flames)`);
  }
  return {
    count: images.length,
    perFrame,
    changeBetweenFrames: steps,
    ...(seam !== null ? { loopSeamChange: seam } : {}),
    silhouetteOverlap: shapes,
    baselineGaps: perFrame.map((frame) => frame.baselineGap),
    warnings,
  };
}

/** Measurements for the reviewer, in cells: palette use, craft (values, noise, outline, pixel size), how the art sits
 * on the grid, animation frames and paperdoll layers. `warnings` names every threshold crossed with its numbers. */
export function analyzePixels(grid: PixelGrid, presets: Preset[] = [], snapped: { key: string; from: string; to: string }[] = []) {
  const { width, height, rgba, keys, frames, layers } = validatePixelGrid(grid);
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
  for (const extra of [...frames.slice(1), ...layers.slice(1)]) for (const key of extra.keys) used.set(key, (used.get(key) ?? 0) + 1);
  const color = new Map(grid.palette.map((entry) => [entry.key, entry.color]));
  const drawn = [...used.keys()].flatMap((key) => {
    const rgba4 = parseColor(color.get(key) ?? "transparent");
    return rgba4[3] > 8 ? [{ key, rgba: rgba4 }] : [];
  });
  // Near-identical colors blur the ramps: every extra step should be visibly different.
  const nearDuplicateColors = drawn.flatMap((a, i) => drawn.slice(i + 1).flatMap((b) => {
    const distance = Math.hypot(a.rgba[0] - b.rgba[0], a.rgba[1] - b.rgba[1], a.rgba[2] - b.rgba[2]);
    return distance < NEAR_COLOR ? [{ keys: [a.key, b.key], distance: Math.round(distance) }] : [];
  }));
  const named = new Set(presets.flatMap((preset) => preset.colors.map((hex) => hex.toLowerCase())));
  // A named palette that contains black (PICO-8, NES, 1-bit) makes black a legal outline color.
  const allowBlack = [...named].some((hex) => Math.max(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))) < 24);
  const still: PixelImage = { width, height, rgba };
  const lint = lintPixels(still, { allowBlack });
  const images = frames.map((frame) => ({ width, height, rgba: frame.rgba }));
  const fit = gridFit(images.length > 1 ? images : [still]);
  const animation = frames.length > 1 ? analyzeFrames(images, { loop: grid.loop ?? true, allowBlack }) : undefined;
  const layerList = layers.map((layer) => ({
    name: layer.name,
    cells: layer.keys.filter((_, i) => layer.rgba[i * 4 + 3] > 8).length,
    contentBox: gridFit([{ width, height, rgba: layer.rgba }])?.contentBox ?? null,
  }));
  const hex = (c: number[]) => `#${[c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const { warnings: frameWarnings = [], ...animationMetrics } = animation ?? {};
  return {
    size: `${width}x${height}`,
    colorsUsed: [...used.keys()].filter((key) => (color.get(key) ?? "").toLowerCase() !== "transparent").length,
    paletteEntriesUnused: grid.palette.filter((entry) => !used.has(entry.key)).map((entry) => entry.key),
    usage: [...used].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, count]) => ({ key, color: color.get(key), cells: count })),
    ...(nearDuplicateColors.length ? { nearDuplicateColors } : {}),
    pureBlackOrWhiteKeys: drawn.filter(({ rgba: c }) => (c[0] + c[1] + c[2] === 0) || (c[0] + c[1] + c[2] === 765)).map(({ key }) => key),
    semiTransparentCells: keys.reduce((count, _, i) => count + (rgba[i * 4 + 3] > 8 && rgba[i * 4 + 3] < 255 ? 1 : 0), 0),
    ...(named.size ? { colorsOutsideNamedPalette: drawn.filter(({ rgba: c }) => !named.has(hex(c))).map(({ key }) => key) } : {}),
    ...(snapped.length ? { snappedToNamedPalette: snapped } : {}),
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
    craft: lint.metrics,
    ...(fit ? { gridFit: fit } : {}),
    ...(animation ? { animation: { ...animationMetrics, fps: grid.fps ?? 8, loop: grid.loop ?? true } } : {}),
    ...(layerList.length ? { layers: layerList } : {}),
    ...(grid.anchors?.length ? { anchors: grid.anchors } : {}),
    warnings: [
      ...lint.warnings,
      ...frameWarnings,
      ...layerList.filter((layer) => !layer.cells).map((layer) => `LAYERS: layer "${layer.name}" is empty`),
      ...(snapped.length ? [`PALETTE: ${snapped.length} off-palette ${snapped.length === 1 ? "entry was" : "entries were"} snapped to the nearest named color (${snapped.map((s) => `"${s.key}" ${s.from} -> ${s.to}`).join(", ")})`] : []),
      ...(fit && !fit.canvasMultipleOf8 ? [`GRID: the canvas is ${width}x${height}; sprite grids and tiles use multiples of 8 (16, 24, 32, 48, 64) unless the brief fixes this size`] : []),
    ],
  };
}

/** A saved pixel image is stored at one image pixel per cell, too small for a vision model to read; its
 * enlarged copy sits beside it. Other images are returned unchanged. */
export const enlarged = (key: string) => (key.endsWith("/pixel.png") ? key.replace(/pixel\.png$/, "preview.png") : key);
