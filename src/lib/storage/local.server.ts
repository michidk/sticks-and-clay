import {
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type { StorageConfig, StorageProvider, StoredObject } from "./types";
import { assertStoragePath, fileMimeType } from "./path";

// Roastbook's provider interface, retaining Asset Studio's realpath confinement.
export class LocalStorageProvider implements StorageProvider {
  readonly basePath: string;
  private readonly baseUrl: string;
  constructor(config: NonNullable<StorageConfig["local"]>) {
    this.basePath = resolve(config.basePath);
    this.baseUrl = config.baseUrl;
  }
  async localPath(key: string, allowMissing = false): Promise<string> {
    assertStoragePath(key);
    const candidate = resolve(this.basePath, key);
    const root = await realpath(this.basePath);
    let ancestor = candidate;
    while (true) {
      try {
        const actual = await realpath(ancestor);
        if (actual !== root && !actual.startsWith(root + sep))
          throw new Error("Invalid storage path");
        return candidate;
      } catch (error) {
        if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT")
          throw error;
        ancestor = dirname(ancestor);
      }
    }
  }
  async upload(file: File | Blob, key: string): Promise<string> {
    assertStoragePath(key);
    await mkdir(this.basePath, { recursive: true });
    const target = await this.localPath(key, true);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await file.arrayBuffer()));
    return key;
  }
  async download(key: string): Promise<Blob> {
    return new Blob([await readFile(await this.localPath(key))], {
      type: fileMimeType(key),
    });
  }
  async delete(key: string) {
    await unlink(await this.localPath(key));
  }
  getUrl(key: string) {
    assertStoragePath(key);
    return (
      this.baseUrl + "/" + key.split("/").map(encodeURIComponent).join("/")
    );
  }
  async exists(key: string) {
    try {
      return (await stat(await this.localPath(key))).isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  async list(prefix?: string) {
    return (await this.listObjects(prefix)).map((object) => object.path);
  }
  async listObjects(prefix?: string): Promise<StoredObject[]> {
    const objects: StoredObject[] = [];
    let start: string;
    try {
      start = prefix
        ? await this.localPath(prefix.replace(/\/$/, ""))
        : this.basePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const walk = async (directory: string): Promise<void> => {
      const metadata = await stat(directory);
      if (metadata.isFile()) {
        objects.push({
          path: relative(this.basePath, directory).split(sep).join("/"),
          sizeBytes: metadata.size,
        });
        return;
      }
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isFile() || entry.isDirectory())
          await walk(resolve(directory, entry.name));
      }
    };
    try {
      await walk(start);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return objects;
  }
}
