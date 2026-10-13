import { getStorage, localStorage } from "./storage/index.server";
import { fileMimeType } from "./storage/path";
import { validateImageFile } from "./image-file";
export { DATA, getStorage } from "./storage/index.server";

// Blender workspaces and session/checkpoint files remain local.
export async function filePath(key: string) {
  return localStorage.localPath(key);
}

export async function readStoredFile(key: string): Promise<Blob> {
  const storage = getStorage();
  if (storage === localStorage) return storage.download(key);
  try {
    return await storage.download(key);
  } catch (error) {
    // Pre-existing assets and in-progress Blender outputs keep their original keys.
    if (
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode !== 404
    )
      throw error;
    return localStorage.download(key);
  }
}

export async function imagePart(key: string) {
  const bytes = Buffer.from(await (await readStoredFile(key)).arrayBuffer());
  const type = fileMimeType(key);
  return {
    type: "file" as const,
    filename: key.split("/").pop(),
    data: `data:${type};base64,${bytes.toString("base64")}`,
    mediaType: type,
  };
}

export async function upload(file: File) {
  const type = await validateImageFile(file);
  const extension =
    type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp";
  const key = `references/${crypto.randomUUID()}.${extension}`;
  return getStorage().upload(new Blob([file], { type }), key);
}

// Publish only completed outputs, before recording them in the database.
// Local archives remain available to Blender and for durable recovery.
export async function publishFiles(keys: readonly string[]) {
  const storage = getStorage();
  if (storage === localStorage) return;
  for (const key of keys)
    await storage.upload(await localStorage.download(key), key);
}
