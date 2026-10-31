import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { DATA, getStorage, localStorage } from "./storage/index.server";
import { assertStoragePath } from "./storage/path";

/** Remove owned media on both stores, retaining files referenced by another project. */
export async function deleteProjectResources({
  prefixes, owned, retained,
}: {
  prefixes: string[];
  owned: unknown;
  retained: unknown;
}) {
  const keys = new Set<string>();
  function collect(value: unknown, into: Set<string>) {
    if (typeof value === "string") {
      // Inputs and checkpoints can contain serialized artifact records.
      for (const match of value.matchAll(/(?:references|imports|starting-points|models|cad|graphics|versions|photographs|project-photographs|mockups|materials|collections|presentations|exports)\/[a-zA-Z0-9_./-]+/g)) {
        try { assertStoragePath(match[0]); into.add(match[0]); } catch { /* Not a storage key. */ }
      }
    } else if (Array.isArray(value)) {
      for (const item of value) collect(item, into);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) collect(item, into);
    }
  }
  collect(owned, keys);
  const shared = new Set<string>();
  collect(retained, shared);
  const providers = [...new Set([getStorage(), localStorage])];
  // Expand directories recorded in old checkpoints as well as known ownership prefixes.
  for (const provider of providers) {
    for (const prefix of new Set([...prefixes, ...keys])) {
      for (const key of await provider.list(prefix)) {
        const base = prefix.replace(/\/$/, "");
        if (key === base || key.startsWith(base + "/")) keys.add(key);
      }
    }
  }
  const thumbnails = await localStorage.list(".thumbnails");
  for (const key of keys) {
    if ([...shared].some((reference) => reference === key || key.startsWith(reference + "/"))) continue;
    for (const provider of providers) {
      if (await provider.exists(key)) await provider.delete(key);
    }
    const hash = createHash("sha1").update(key).digest("hex");
    for (const file of thumbnails) {
      if (file.startsWith(`.thumbnails/${hash}-`)) await rm(resolve(DATA, file), { force: true });
    }
  }
}
