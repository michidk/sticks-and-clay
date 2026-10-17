import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { DATA, readStoredFile } from "./storage.server";
import { fileMimeType } from "./storage/path";

export const THUMBNAIL_WIDTHS = [320, 640, 1280] as const;
const raster = new Set(["image/png", "image/jpeg", "image/webp"]);

/** A compressed WebP copy of a stored image, made on first request and cached on disk.
 * Returns null for anything that is not a raster image, so callers fall back to the original. */
export async function thumbnail(key: string, width: number) {
  if (!raster.has(fileMimeType(key)) || !(THUMBNAIL_WIDTHS as readonly number[]).includes(width)) return null;
  const directory = resolve(DATA, ".thumbnails");
  const file = resolve(directory, `${createHash("sha1").update(key).digest("hex")}-${width}.webp`);
  try {
    return await readFile(file);
  } catch {
    const bytes = await sharp(Buffer.from(await (await readStoredFile(key)).arrayBuffer()))
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    await mkdir(directory, { recursive: true });
    const temporary = `${file}.${crypto.randomUUID()}`;
    await writeFile(temporary, bytes);
    await rename(temporary, file); // concurrent requests never see a partial file
    return bytes;
  }
}
