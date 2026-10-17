import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { DATA, readStoredFile } from "./storage.server";
import { fileMimeType } from "./storage/path";

export const THUMBNAIL_WIDTHS = [320, 640, 1280] as const;
const raster = new Set(["image/png", "image/jpeg", "image/webp"]);
const isRaster = (key: string) => raster.has(fileMimeType(key));
const fileFor = (key: string, width: number) =>
  resolve(DATA, ".thumbnails", `${createHash("sha1").update(key).digest("hex")}-${width}.webp`);

const making = new Map<string, Promise<void>>();
let active = 0;
const waiting: (() => void)[] = [];
/** At most three images are decoded at once, so a first view of a big project cannot starve the server. */
async function slot<T>(work: () => Promise<T>) {
  if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await work();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** All sizes of one image, from a single decode; concurrent requests for the same image share the work. */
function make(key: string) {
  let pending = making.get(key);
  if (!pending) {
    pending = slot(async () => {
      const source = sharp(Buffer.from(await (await readStoredFile(key)).arrayBuffer())).rotate();
      await mkdir(resolve(DATA, ".thumbnails"), { recursive: true });
      for (const width of THUMBNAIL_WIDTHS) {
        const bytes = await source.clone().resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
        const file = fileFor(key, width);
        const temporary = `${file}.${crypto.randomUUID()}`;
        await writeFile(temporary, bytes);
        await rename(temporary, file); // concurrent readers never see a partial file
      }
    }).finally(() => making.delete(key));
    making.set(key, pending);
  }
  return pending;
}

/** A compressed WebP copy of a stored image, made on first request and cached on disk.
 * Returns null for anything that is not a raster image, so callers fall back to the original. */
export async function thumbnail(key: string, width: number) {
  if (!isRaster(key) || !(THUMBNAIL_WIDTHS as readonly number[]).includes(width)) return null;
  try {
    return await readFile(fileFor(key, width));
  } catch {
    await make(key);
    return readFile(fileFor(key, width));
  }
}

/** Raster image keys mentioned anywhere in a payload. */
export function imageKeys(payload: unknown, limit = 300) {
  const found = new Set<string>();
  for (const match of JSON.stringify(payload).matchAll(/"((?:[\w.-]+\/)+[\w.-]+\.(?:png|jpe?g|webp))"/gi)) {
    found.add(match[1]);
    if (found.size >= limit) break;
  }
  return [...found];
}

/** Make the thumbnails for images a page is about to ask for, in the background, so they are ready
 * before the browser requests them. Failures are ignored: the file endpoint falls back to the original. */
export function warmThumbnails(keys: readonly string[]) {
  for (const key of keys)
    if (isRaster(key)) void readFile(fileFor(key, 640)).catch(() => make(key)).catch(() => undefined);
}
