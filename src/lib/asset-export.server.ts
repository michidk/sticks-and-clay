import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { assetVersions } from "../db/schema";
import { collectionAssetGroups } from "./project-summary";
import { sourceZip } from "./source-bundle.server";
import { getStorage, readStoredFile } from "./storage.server";
import { assertStoragePath, storageUrl } from "./storage/path";
import type { ExportInput } from "./api-inputs";

type Asset = typeof assetVersions.$inferSelect;
const partFiles = z.array(z.object({ name: z.string(), key: z.string() }));
const fileKey = /^[a-z-]+\/\S+\.[a-z0-9]+$/i;

/** Accept marks a finished attempt as done; it never changes the AI verdict or files. */
export async function setModelAccepted(modelId: string, accepted: boolean) {
  const [model] = await db.select({ status: assetVersions.status }).from(assetVersions).where(eq(assetVersions.id, modelId));
  if (!model) throw new Error("Model not found");
  if (accepted && model.status !== "done") throw new Error("Only finished assets can be accepted");
  await db.update(assetVersions).set({ acceptedAt: accepted ? new Date() : null }).where(eq(assetVersions.id, modelId));
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";

/** Every stored file an asset references, named by the artifact field that holds it. */
export function exportEntries<T extends Pick<Asset, "id" | "name" | "artifacts" | "visualTarget">>(assets: T[]) {
  const folders = new Set<string>();
  return assets.map((asset) => {
    let folder = slug(asset.name);
    for (let n = 2; folders.has(folder); n++) folder = `${slug(asset.name)}-${n}`;
    folders.add(folder);
    const files = new Map<string, string>();
    const add = (key: string, group?: string, filename?: string) => {
      if (!fileKey.test(key) || [...files.values()].includes(key)) return;
      try { assertStoragePath(key); } catch { return; }
      const base = `${folder}/${group ? `${group}/` : ""}${filename ?? key.split("/").pop()}`;
      let name = base;
      for (let n = 2; files.has(name); n++) name = base.replace(/(\.[^.]+)$/, `-${n}$1`);
      files.set(name, key);
    };
    const walk = (value: unknown, group?: string) => {
      if (typeof value === "string") add(value, group);
      else if (Array.isArray(value)) value.forEach((item) => walk(item, group));
      else if (value && typeof value === "object") for (const [field, item] of Object.entries(value))
        walk(item, group ?? (typeof item === "string" ? undefined : field));
    };
    const parsedParts = partFiles.safeParse(asset.artifacts?.parts);
    const parts = parsedParts.success ? parsedParts.data : [];
    for (const part of parts) add(part.key, "parts", `${slug(part.name)}.${part.key.split(".").pop()}`);
    for (const [field, value] of Object.entries(asset.artifacts ?? {}))
      if (field !== "parts") walk(value, typeof value === "string" ? undefined : field);
    if (asset.visualTarget) add(asset.visualTarget, "visual-target");
    return {
      asset, folder, files,
      parts: parts.map((part) => ({ ...part, file: [...files].find(([, key]) => key === part.key)?.[0] ?? null })),
    };
  });
}

/** Zip the chosen finished assets into storage and return the archive key. */
export async function exportAssets(projectId: string, input: ExportInput) {
  const all = await db.select().from(assetVersions).where(and(
    eq(assetVersions.projectId, projectId), eq(assetVersions.status, "done"),
    ...(input.modelIds ? [inArray(assetVersions.id, input.modelIds)] : []),
  ));
  // Without a selection, export the collection's current entries rather than every past iteration.
  const chosen = (input.modelIds ? all : collectionAssetGroups(all).map((group) => group.representative))
    .filter((asset) => !input.acceptedOnly || asset.acceptedAt);
  if (input.modelIds && chosen.length !== input.modelIds.length)
    throw new Error("Choose finished assets from this project");
  if (!chosen.length) throw new Error("No finished assets match this export");
  const archive: { name: string; bytes: Uint8Array }[] = [];
  const manifest = [];
  // shortcut: the zip is assembled in memory; stream it if exports grow past a few hundred MiB.
  for (const { asset, folder, files, parts } of exportEntries(chosen)) {
    const missing: string[] = [];
    for (const [name, key] of files) {
      try { archive.push({ name, bytes: new Uint8Array(await (await readStoredFile(key)).arrayBuffer()) }); }
      catch { missing.push(key); }
    }
    manifest.push({
      id: asset.id, name: asset.name, folder, prompt: asset.prompt, verdict: asset.verdict,
      ...(parts.length ? { parts: parts.map((part) => ({ ...part, file: missing.includes(part.key) ? null : part.file })) } : {}),
      acceptedAt: asset.acceptedAt, files: [...files.keys()].filter((name) => !missing.includes(files.get(name)!)), missing,
    });
  }
  archive.push({ name: "manifest.json", bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  // shortcut: exports are kept until storage cleanup; prune exports/ if they pile up.
  const key = `exports/${projectId}/${crypto.randomUUID()}.zip`;
  await getStorage().upload(new Blob([sourceZip(archive)], { type: "application/zip" }), key);
  return { key, url: storageUrl(key), assets: chosen.length, files: archive.length - 1 };
}
