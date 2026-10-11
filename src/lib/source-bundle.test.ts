import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleFiles, writeSourceZip } from "./source-bundle.server";

test("streamed ZIP preserves payloads, CRCs and last successful archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "studio-zip-"));
  try {
    await writeFile(join(root, "asset.py"), "123456789");
    await writeFile(join(root, "large.bin"), Buffer.alloc(2 * 1024 * 1024, 42));
    const files = await bundleFiles(root);
    expect(files.every((file) => !("bytes" in file))).toBe(true);
    const destination = join(root, "source.zip");
    await writeSourceZip(destination, files);
    const bytes = await readFile(destination);
    const end = bytes.length - 22;
    expect(bytes.readUInt16LE(end + 8)).toBe(2);
    let cursor = bytes.readUInt32LE(end + 16);
    for (const file of files) {
      expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50);
      const size = bytes.readUInt32LE(cursor + 24);
      const nameLength = bytes.readUInt16LE(cursor + 28);
      const local = bytes.readUInt32LE(cursor + 42);
      expect(bytes.readUInt16LE(local + 6) & 8).toBe(8);
      const start = local + 30 + bytes.readUInt16LE(local + 26);
      expect(bytes.subarray(start, start + size)).toEqual(
        await readFile(file.path),
      );
      if (file.name === "asset.py")
        expect(bytes.readUInt32LE(cursor + 16)).toBe(0xcbf43926);
      expect(bytes.readUInt32LE(start + size)).toBe(0x08074b50);
      cursor += 46 + nameLength;
    }
    await writeFile(join(root, "asset.py"), "changed input");
    await expect(writeSourceZip(destination, files)).rejects.toThrow(
      "changed while packaging",
    );
    expect(await readFile(destination)).toEqual(bytes);
    await expect(
      writeSourceZip(destination, [
        { name: "../secret", bytes: Buffer.from("x") },
      ]),
    ).rejects.toThrow("Invalid bundle path");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
