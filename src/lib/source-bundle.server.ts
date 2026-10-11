import { readdir, lstat, rename, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
export type BundleFile = {
  name: string;
  path: string;
  size: number;
  sha256: string;
};

/** Only file metadata is retained; payloads are hashed and zipped in bounded chunks. */
export async function bundleFiles(directory: string) {
  const files: BundleFile[] = [];
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
        const path = resolve(directory, name),
          fileSize = (await lstat(path)).size;
        size += fileSize;
        if (size > 1024 * 1024 * 1024 || files.length >= 60000)
          throw new Error("Source bundle is too large");
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        files.push({ name, path, size: fileSize, sha256: hash.digest("hex") });
      }
    }
  }
  await visit();
  return files;
}

/** ZIP data descriptors allow payloads to stream before their CRC is known. */
export async function writeSourceZip(
  destination: string,
  files: (BundleFile | { name: string; bytes: Uint8Array })[],
) {
  if (files.length > 60000) throw new Error("Source bundle is too large");
  async function* chunks() {
    let offset = 0,
      total = 0;
    const records: Buffer[] = [];
    for (const file of files) {
      if (/\\|^\/|(^|\/)\.\.(\/|$)/.test(file.name))
        throw new Error("Invalid bundle path");
      const name = Buffer.from(file.name);
      if (name.length > 65535) throw new Error("Bundle path is too long");
      const header = Buffer.alloc(30),
        start = offset;
      header.writeUInt32LE(0x04034b50);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0x808, 6); // UTF-8 and a following data descriptor
      header.writeUInt16LE(name.length, 26);
      yield header;
      yield name;
      offset += header.length + name.length;
      let crc = 0xffffffff,
        size = 0;
      const hash = createHash("sha256");
      const payload =
        "path" in file
          ? createReadStream(file.path, { highWaterMark: 64 * 1024 })
          : [file.bytes];
      for await (const chunk of payload) {
        size += chunk.length;
        total += chunk.length;
        if (total > 1024 * 1024 * 1024)
          throw new Error("Source bundle is too large");
        hash.update(chunk);
        for (const byte of chunk)
          crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
        yield chunk;
      }
      const digest = hash.digest("hex");
      if ("path" in file && (size !== file.size || digest !== file.sha256))
        throw new Error(`Bundle input changed while packaging: ${file.name}`);
      crc = (crc ^ 0xffffffff) >>> 0;
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(size, 8);
      descriptor.writeUInt32LE(size, 12);
      yield descriptor;
      offset += size + descriptor.length;
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50);
      record.writeUInt16LE(20, 4);
      record.writeUInt16LE(20, 6);
      record.writeUInt16LE(0x808, 8);
      record.writeUInt32LE(crc, 16);
      record.writeUInt32LE(size, 20);
      record.writeUInt32LE(size, 24);
      record.writeUInt16LE(name.length, 28);
      record.writeUInt32LE(start, 42);
      records.push(record, name);
    }
    let directorySize = 0;
    for (const record of records) {
      directorySize += record.length;
      yield record;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(offset, 16);
    yield end;
  }
  const temporary = resolve(
    dirname(destination),
    `.candidate-zip-${randomUUID()}`,
  );
  try {
    await pipeline(
      Readable.from(chunks()),
      createWriteStream(temporary, { flags: "wx" }),
    );
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
