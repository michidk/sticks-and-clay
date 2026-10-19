import { readStoredFile } from "./storage.server";

export async function pngResolution(key: string) {
  const bytes = Buffer.from(await (await readStoredFile(key)).slice(0, 24).arrayBuffer());
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR")
    throw new Error("Cannot read PNG output dimensions");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height) throw new Error("PNG output dimensions must be positive");
  return { width, height };
}
