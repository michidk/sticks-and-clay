import sharp from "sharp";
import { validatePixelGrid, type PixelGrid } from "./pixel";

const PREVIEW = 768;

/** The art at its true size (one image pixel per cell, what gets used and shown), plus an enlarged copy
 * on white for the reviewer: whole-number scaling with no smoothing, so every cell stays a crisp square. */
export async function renderPixels(grid: PixelGrid) {
  const { width, height, rgba } = validatePixelGrid(grid);
  const native = await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toBuffer();
  const scale = Math.max(1, Math.floor(PREVIEW / Math.max(width, height)));
  const preview = await sharp(native)
    .resize(width * scale, height * scale, { kernel: "nearest" })
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
  // Keep preview.png stable for saved references. Review evidence is a separate sheet.
  const panels: { input: Buffer; left: number; top: number }[] = [];
  const panelSize = Math.max(256, width * 3 + 32, height * 3 + 32);
  const titles = ["1x light / dark", "2x dark", "3x light", "enlarged dark", "silhouette", "grayscale"];
  const variants = [native, native, native, native,
    await sharp(Buffer.from(rgba.map((v, i) => i % 4 === 3 ? v : 24)), { raw: { width, height, channels: 4 } }).png().toBuffer(),
    await sharp(native).greyscale().png().toBuffer()];
  for (let i = 0; i < variants.length; i++) {
    const factor = i === 0 ? 1 : i === 1 ? 2 : i === 2 ? 3 : Math.max(1, Math.floor(224 / Math.max(width, height)));
    const w = width * factor, h = height * factor;
    const input = await sharp(variants[i]).resize(w, h, { kernel: "nearest" }).png().toBuffer();
    const x = (i % 3) * panelSize, y = Math.floor(i / 3) * panelSize;
    const background = i === 1 || i === 3 ? "#242a28" : "#f8f5ec";
    const title = Buffer.from(`<svg width="${panelSize}" height="24"><text x="8" y="17" font-family="sans-serif" font-size="13" fill="${i === 1 || i === 3 ? "#f8f5ec" : "#242a28"}">${titles[i]}</text></svg>`);
    const art = i === 0 ? [
      { input: await sharp({ create: { width: Math.floor(panelSize / 2), height: panelSize - 24, channels: 4, background: "#242a28" } }).png().toBuffer(), left: Math.floor(panelSize / 2), top: 24 },
      { input, left: Math.floor(panelSize / 4 - w / 2), top: Math.floor((panelSize - h) / 2) + 12 },
      { input, left: Math.floor(panelSize * 3 / 4 - w / 2), top: Math.floor((panelSize - h) / 2) + 12 },
    ] : [{ input, left: Math.floor((panelSize - w) / 2), top: Math.floor((panelSize - h) / 2) + 12 }];
    const panel = await sharp({ create: { width: panelSize, height: panelSize, channels: 4, background } })
      .composite([...art, { input: title, left: 0, top: 0 }]).png().toBuffer();
    panels.push({ input: panel, left: x, top: y });
  }
  const review = await sharp({ create: { width: panelSize * 3, height: panelSize * 2, channels: 4, background: "#f8f5ec" } })
    .composite(panels).png().toBuffer();
  return { native, preview, review, scale };
}
