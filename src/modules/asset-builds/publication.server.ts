import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";

/** Resolve once per read/archive operation so a concurrent commit cannot mix generations. */
export async function committedDirectory(directory: string) {
  const pointer = await readFile(
    resolve(directory, "output-current.json"),
    "utf8",
  ).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!pointer) return directory; // Immutable pre-protocol-3 archives retain their layout.
  const record = JSON.parse(pointer);
  if (!/^\.published\/[a-f0-9]{32}$/.test(record.directory))
    throw new Error("Invalid publication directory");
  const root = await realpath(directory),
    generation = await realpath(resolve(directory, record.directory));
  if (!generation.startsWith(root + sep))
    throw new Error("Invalid publication path");
  const receipt = await readFile(resolve(generation, "build-receipt.json"));
  if (
    createHash("sha256").update(receipt).digest("hex") !== record.receiptSha256
  )
    throw new Error("Committed build receipt changed");
  return generation;
}
