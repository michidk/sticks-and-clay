import { resolve, relative, sep } from "node:path";
import { mkdir, realpath, readFile, writeFile } from "node:fs/promises";
export const DATA = resolve(process.env.STUDIO_DATA_DIR || "data");
export async function filePath(key: string) {
  const candidate = resolve(DATA, key);
  if (
    !relative(DATA, candidate) ||
    relative(DATA, candidate).startsWith(".." + sep) ||
    relative(DATA, candidate) === ".."
  )
    throw new Error("Invalid path");
  const actual = await realpath(candidate);
  if (!actual.startsWith((await realpath(DATA)) + sep))
    throw new Error("Invalid path");
  return actual;
}
export async function imagePart(key: string) {
  const path = await filePath(key);
  const bytes = await readFile(path);
  const type = key.endsWith(".jpg")
    ? "image/jpeg"
    : key.endsWith(".webp")
      ? "image/webp"
      : "image/png";
  return {
    type: "file" as const,
    filename: key.split("/").pop(),
    data: `data:${type};base64,${bytes.toString("base64")}`,
    mediaType: type,
  };
}
export async function upload(file: File) {
  if (file.size > 8 * 1024 * 1024 || file.size === 0)
    throw new Error("Images must be between 1 byte and 8 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  if (!png && !jpg && !webp)
    throw new Error("Use PNG, JPEG or WebP reference images");
  const key = `references/${crypto.randomUUID()}.${png ? "png" : jpg ? "jpg" : "webp"}`;
  await mkdir(resolve(DATA, "references"), { recursive: true });
  await writeFile(resolve(DATA, key), bytes);
  return key;
}
