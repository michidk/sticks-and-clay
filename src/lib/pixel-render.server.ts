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
  return { native, preview, scale };
}
