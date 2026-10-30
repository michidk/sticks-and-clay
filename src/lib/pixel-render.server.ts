import sharp from "sharp";
import { validatePixelGrid, type PixelGrid, type PixelImage } from "./pixel";
import { godotSpriteFrames, spriteSheet, unitySpriteMeta } from "./pixel-export";

const PREVIEW = 768;
type Color = [number, number, number, number];
const SHEET: Color = [20, 20, 24, 255];
const DARK: Color = [40, 42, 48, 255];
const MID: Color = [58, 60, 66, 255];
const LIGHT: Color = [196, 200, 206, 255];
const LABEL = "#aab0ba";
const PAD = 12, TEXT = 16;

const png = ({ width, height, rgba }: PixelImage) =>
  sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toBuffer();

/** A blank image filled with one color. */
function canvas(width: number, height: number, fill: Color = [0, 0, 0, 0]): PixelImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set(fill, i);
  return { width, height, rgba };
}

/** Draws `source` enlarged `scale` times (whole cells, no smoothing) over `target` at (left, top), alpha-blended. */
function draw(target: PixelImage, source: PixelImage, left: number, top: number, scale = 1) {
  for (let y = 0; y < source.height * scale; y++) for (let x = 0; x < source.width * scale; x++) {
    const tx = left + x, ty = top + y;
    if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
    const s = (Math.floor(y / scale) * source.width + Math.floor(x / scale)) * 4, t = (ty * target.width + tx) * 4;
    const a = source.rgba[s + 3] / 255;
    if (!a) continue;
    for (let c = 0; c < 3; c++) target.rgba[t + c] = Math.round(source.rgba[s + c] * a + target.rgba[t + c] * (1 - a));
    target.rgba[t + 3] = Math.max(target.rgba[t + 3], source.rgba[s + 3]);
  }
}

/** The image on a solid background, enlarged. */
function tile(image: PixelImage, scale: number, background: Color) {
  const out = canvas(image.width * scale, image.height * scale, background);
  draw(out, image, 0, 0, scale);
  return out;
}

/** Per-cell recolor; transparent cells stay transparent. */
function recolor(image: PixelImage, map: (r: number, g: number, b: number) => [number, number, number]) {
  const rgba = new Uint8Array(image.rgba);
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) rgba.set(map(rgba[i], rgba[i + 1], rgba[i + 2]), i);
  return { ...image, rgba };
}
const silhouette = (image: PixelImage) => {
  const rgba = new Uint8Array(image.rgba.length);
  for (let i = 0; i < rgba.length; i += 4) rgba.set(image.rgba[i + 3] > 8 ? [24, 24, 28, 255] : [0, 0, 0, 0], i);
  return { ...image, rgba };
};
const grey = (r: number, g: number, b: number): [number, number, number] => {
  const v = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  return [v, v, v];
};

/** The zoom panel: every cell `scale` pixels on mid grey, a faint line between cells and a stronger one every 8. */
function zoomed(image: PixelImage, scale: number) {
  const out = tile(image, scale, MID);
  if (scale < 6) return out;
  const line = (x: number, y: number, strong: boolean) => {
    const t = (y * out.width + x) * 4, a = strong ? 0.28 : 0.13;
    for (let c = 0; c < 3; c++) out.rgba[t + c] = Math.round(255 * a + out.rgba[t + c] * (1 - a));
  };
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const onColumn = x % scale === 0, onRow = y % scale === 0;
    if (onColumn || onRow) line(x, y, (onColumn && (x / scale) % 8 === 0) || (onRow && (y / scale) % 8 === 0));
  }
  return out;
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
type Label = { x: number; y: number; text: string; anchor?: "start" | "middle" | "end"; size?: number; color?: string };

/** The sheet a pixel artist judges by, also shown to the drawer on revision rounds: the art zoomed with a cell grid
 * (row and column numbers every 8 cells, from 1), at 1x on dark and on light, at 2x and 3x, as a silhouette and in
 * greyscale values, the colors used sorted dark to light with their palette keys, and the frames or layers when there
 * are any. */
export async function reviewSheet(grid: PixelGrid) {
  const { width: w, height: h, rgba, frames, layers } = validatePixelGrid(grid);
  const image: PixelImage = { width: w, height: h, rgba };
  const zoom = Math.max(1, Math.min(12, Math.floor(512 / Math.max(w, h))));
  const big = zoomed(image, zoom);
  const ruler = 22; // room for the row and column numbers
  const repeated = canvas(w * 3, h * 3, DARK);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) draw(repeated, image, x * w, y * h);
  const tiles: [string, PixelImage][] = [
    ["1x on dark", tile(image, 1, DARK)], ["1x on light", tile(image, 1, LIGHT)],
    ["2x", tile(image, 2, DARK)], ["3x", tile(image, 3, DARK)],
    ["Silhouette", tile(silhouette(image), 2, LIGHT)], ["Values", tile(recolor(image, grey), 2, MID)],
    ["Repeat 3x3", repeated], ["Native values", tile(recolor(image, grey), 1, MID)],
  ];
  const cell = Math.max(80, ...tiles.map(([, t]) => t.width));
  const tileRows = [tiles.slice(0, 2), tiles.slice(2, 4), tiles.slice(4, 6), tiles.slice(6, 8)];
  const columnHeight = tileRows.reduce((sum, row) => sum + Math.max(...row.map(([, t]) => t.height)) + TEXT + PAD, 0);
  const width = PAD + ruler + big.width + PAD * 2 + cell * 2 + PAD + PAD;
  const labels: Label[] = [];

  // Palette: every color drawn, dark to light, with its key(s) and hex.
  const drawnKeys = new Set([grid.rows, ...(grid.frames ?? []).map((f) => f.rows), ...(grid.layers ?? []).map((l) => l.rows)].flat().flatMap((line) => [...line]));
  const swatches = grid.palette
    .filter((entry) => drawnKeys.has(entry.key) && entry.color.toLowerCase() !== "transparent")
    .map((entry) => {
      const n = parseInt(entry.color.slice(1, 7), 16);
      const c: Color = [(n >> 16) & 255, (n >> 8) & 255, n & 255, entry.color.length > 7 ? parseInt(entry.color.slice(7, 9), 16) : 255];
      return { ...entry, rgba: c, value: grey(c[0], c[1], c[2])[0] };
    })
    .sort((a, b) => a.value - b.value);
  const swatchWidth = 74, swatchSize = 20;
  const perRow = Math.max(1, Math.floor((width - 2 * PAD) / swatchWidth));
  const paletteHeight = TEXT + Math.ceil(swatches.length / perRow) * (swatchSize + TEXT + 4) + PAD;

  // Frames or layers, each at a scale that keeps a strip readable.
  const extras: [string, PixelImage][] = frames.length > 1
    ? frames.map((frame, i) => [`Frame ${i + 1}`, { width: w, height: h, rgba: frame.rgba }])
    : layers.map((layer, i) => [`${i}: ${layer.name}`.slice(0, 18), { width: w, height: h, rgba: layer.rgba }]);
  const extraScale = Math.max(1, Math.min(4, Math.floor(160 / Math.max(w, h))));
  const extraWidth = Math.max(w * extraScale, 72), extraHeight = h * extraScale;
  const extrasPerRow = Math.max(1, Math.floor((width - 2 * PAD) / (extraWidth + PAD)));
  const extrasHeight = extras.length ? TEXT + Math.ceil(extras.length / extrasPerRow) * (extraHeight + TEXT + PAD) : 0;

  const top = PAD + TEXT;
  const mainHeight = Math.max(ruler + big.height, columnHeight);
  const height = top + mainHeight + PAD + paletteHeight + extrasHeight + PAD;
  const sheet = canvas(width, height, SHEET);

  labels.push({ x: PAD, y: PAD + 11, text: `${w}x${h} · ${zoom}x · 1-based cells · bold grid: 8`, size: 10 });
  const zx = PAD + ruler, zy = top + ruler;
  draw(sheet, big, zx, zy);
  for (let n = 0; n < Math.max(w, h); n += 8) {
    if (n < w && zoom >= 4) labels.push({ x: zx + n * zoom + zoom / 2, y: zy - 6, text: String(n + 1), anchor: "middle", size: 10 });
    if (n < h && zoom >= 4) labels.push({ x: zx - 4, y: zy + n * zoom + zoom / 2 + 4, text: String(n + 1), anchor: "end", size: 10 });
  }
  for (const anchor of grid.anchors ?? []) {
    const cx = zx + anchor.x * zoom + Math.floor(zoom / 2), cy = zy + anchor.y * zoom + Math.floor(zoom / 2);
    for (let d = -Math.max(3, zoom); d <= Math.max(3, zoom); d++) {
      for (const [x, y] of [[cx + d, cy], [cx, cy + d]])
        if (x >= 0 && y >= 0 && x < width && y < height) sheet.rgba.set([255, 64, 200, 255], (y * width + x) * 4);
    }
    labels.push({ x: cx + 5, y: cy - 5, text: anchor.name, size: 10, color: "#ff70d0" });
  }

  let y = top;
  const x0 = zx + big.width + PAD * 2;
  for (const row of tileRows) {
    row.forEach(([name, t], i) => {
      const x = x0 + i * (cell + PAD);
      labels.push({ x, y: y + 11, text: name });
      draw(sheet, t, x, y + TEXT);
    });
    y += Math.max(...row.map(([, t]) => t.height)) + TEXT + PAD;
  }

  y = top + mainHeight + PAD;
  labels.push({ x: PAD, y: y + 11, text: `${swatches.length} colors, dark to light (key and hex)` });
  swatches.forEach((swatch, i) => {
    const sx = PAD + (i % perRow) * swatchWidth, sy = y + TEXT + Math.floor(i / perRow) * (swatchSize + TEXT + 4);
    draw(sheet, canvas(swatchSize, swatchSize, swatch.rgba), sx, sy);
    labels.push({ x: sx + swatchSize + 4, y: sy + 15, text: swatch.key, size: 13, color: "#e6e8ec" });
    labels.push({ x: sx, y: sy + swatchSize + 12, text: swatch.color.toLowerCase(), size: 10 });
  });
  y += paletteHeight;

  if (extras.length) {
    labels.push({ x: PAD, y: y + 11, text: frames.length > 1 ? `Frames at ${extraScale}x (${grid.fps ?? 8} fps, ${grid.loop ?? true ? "looping" : "plays once"})` : `Layers at ${extraScale}x, bottom to top` });
    extras.forEach(([name, image], i) => {
      const ex = PAD + (i % extrasPerRow) * (extraWidth + PAD), ey = y + TEXT + Math.floor(i / extrasPerRow) * (extraHeight + TEXT + PAD);
      draw(sheet, tile(image, extraScale, MID), ex, ey);
      labels.push({ x: ex, y: ey + extraHeight + 12, text: name, size: 11 });
    });
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${labels
    .map((l) => `<text x="${l.x}" y="${l.y}" font-family="sans-serif" font-size="${l.size ?? 12}" fill="${l.color ?? LABEL}" text-anchor="${l.anchor ?? "start"}">${escape(l.text)}</text>`)
    .join("")}</svg>`;
  return sharp(Buffer.from(sheet.rgba), { raw: { width, height, channels: 4 } })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .png()
    .toBuffer();
}

/** The art at its true size (one image pixel per cell, what gets used and shown), an enlarged copy on white (shown
 * to vision models when the art is a reference or a variant source), the review sheet, and the engine exports: a
 * baseline-aligned sheet with its layout, Unity and Godot import descriptions, an animated GIF for animations and one
 * PNG per paperdoll layer. */
export async function renderPixels(grid: PixelGrid) {
  const { width, height, rgba, frames, layers } = validatePixelGrid(grid);
  const native = await png({ width, height, rgba });
  const scale = Math.max(1, Math.floor(PREVIEW / Math.max(width, height)));
  const preview = await sharp(native)
    .resize(width * scale, height * scale, { kernel: "nearest" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  const images = frames.length > 1 ? frames.map((frame) => ({ width, height, rgba: frame.rgba })) : [{ width, height, rgba }];
  const sheet = spriteSheet(images, { fps: grid.fps ?? 8, loop: grid.loop ?? true });
  const files: { id: string; name: string; data: Buffer | string; type: string }[] = [
    { id: "sheet", name: "sheet.png", data: await png(sheet.image), type: "image/png" },
    { id: "sheetLayout", name: "sheet.json", data: JSON.stringify(sheet.layout, null, 2), type: "application/json" },
    { id: "unity", name: "sheet.unity.json", data: JSON.stringify(unitySpriteMeta(sheet.layout, "sheet.png"), null, 2), type: "application/json" },
    { id: "godot", name: "sheet.godot.json", data: JSON.stringify(godotSpriteFrames(sheet.layout, "sheet.png"), null, 2), type: "application/json" },
  ];
  if (frames.length > 1) {
    const gifScale = Math.max(1, Math.floor(256 / Math.max(width, height)));
    const pages = await Promise.all(images.map((image) => png(tile(image, gifScale, [0, 0, 0, 0]))));
    const gif = await sharp(pages, { join: { animated: true } })
      .gif({ delay: images.map(() => Math.round(1000 / (grid.fps ?? 8))), loop: grid.loop ?? true ? 0 : 1, dither: 0, keepDuplicateFrames: true })
      .toBuffer();
    files.push({ id: "animation", name: "anim.gif", data: gif, type: "image/gif" });
  }
  if (layers.length) {
    const index = [];
    for (const [z, layer] of layers.entries()) {
      const name = `layer-${String(z).padStart(2, "0")}-${layer.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "layer"}.png`;
      files.push({ id: `layer${z}`, name, data: await png({ width, height, rgba: layer.rgba }), type: "image/png" });
      index.push({ name: layer.name, z, file: name });
    }
    files.push({
      id: "layers",
      name: "layers.json",
      data: JSON.stringify({ version: 1, width, height, order: "bottom to top, shared registration", layers: index, anchors: grid.anchors ?? [] }, null, 2),
      type: "application/json",
    });
  }
  return { native, preview, scale, review: await reviewSheet(grid), files };
}
