import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorageProvider } from "./local.server";

test("local provider supports Roastbook's file lifecycle without changing stored keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-storage-"));
  const storage = new LocalStorageProvider({
    basePath: root,
    baseUrl: "/api/files",
  });
  try {
    const key = "references/photo with spaces.png";
    await storage.upload(new Blob(["image"], { type: "image/png" }), key);
    expect(await storage.exists(key)).toBe(true);
    expect((await storage.download(key)).type).toBe("image/png");
    expect(await (await storage.download(key)).text()).toBe("image");
    expect(storage.getUrl(key)).toBe(
      "/api/files/references/photo%20with%20spaces.png",
    );
    expect(await storage.list("references")).toEqual([key]);
    expect(await storage.listObjects(key)).toEqual([
      { path: key, sizeBytes: 5 },
    ]);
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("storage rejects traversal and symlink escapes on reads and writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-paths-"));
  const base = join(root, "data");
  await mkdir(base);
  const storage = new LocalStorageProvider({
    basePath: base,
    baseUrl: "/api/files",
  });
  try {
    for (const key of [
      "../secret",
      "/tmp/secret",
      "%2e%2e/secret",
      "%252e%252e/secret",
      "x/../../secret",
      "x\\..\\secret",
      "C:/secret",
      ".",
      "",
    ]) {
      await expect(storage.upload(new Blob(["bad"]), key)).rejects.toThrow();
      await expect(storage.download(key)).rejects.toThrow();
    }
    await writeFile(join(root, "secret"), "private");
    await symlink(root, join(base, "escape"));
    await expect(storage.download("escape/secret")).rejects.toThrow(
      "Invalid storage path",
    );
    await expect(
      storage.upload(new Blob(["bad"]), "escape/new/file"),
    ).rejects.toThrow("Invalid storage path");
    expect(await storage.list()).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
