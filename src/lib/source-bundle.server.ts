import { readFile, readdir, lstat } from "node:fs/promises";
import { resolve } from "node:path";
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
  return (crc ^ 0xffffffff) >>> 0;
}
/** Stored ZIP with standard UTF-8 paths, independent of platform shell tools. */
export function sourceZip(files: { name: string; bytes: Uint8Array }[]) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    if (/\\|^\/|(^|\/)\.\.(\/|$)/.test(file.name))
      throw new Error("Invalid bundle path");
    const name = Buffer.from(file.name),
      bytes = Buffer.from(file.bytes),
      crc = crc32(bytes),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, bytes);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export async function bundleFiles(directory: string) {
  const files: { name: string; bytes: Buffer }[] = [];
  let size = 0;
  async function visit(relative = "") {
    for (const entry of await readdir(resolve(directory, relative), {
      withFileTypes: true,
    })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (
        entry.isSymbolicLink() ||
        entry.name === "__pycache__" ||
        [
          "source-bundle.zip",
          "source.zip",
          "delivery.zip",
          "build-manifest.json",
          "bundle-stats.json",
          "output.last",
          ".published",
          "publication-pending.json",
          "output-current.json",
        ].includes(entry.name) ||
        entry.name.startsWith(".candidate-")
      )
        continue;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        size += (await lstat(resolve(directory, name))).size;
        if (size > 1024 * 1024 * 1024 || files.length >= 60000)
          throw new Error("Source bundle is too large");
        files.push({ name, bytes: await readFile(resolve(directory, name)) });
      }
    }
  }
  await visit();
  return files;
}
