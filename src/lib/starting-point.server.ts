import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { db } from "../db/client";
import { assetEntries, assetVersions, projects, runs } from "../db/schema";
import { DATA, getStorage, readStoredFile } from "./storage.server";
import { fileMimeType } from "./storage/path";
import { startingPointExtension, startingPointSchema, type StartingPoint } from "./starting-point";
import type { AssetType } from "./asset-types";
import { validateSvg } from "./svg";
import { pixelGridSchema, resolvePixelAnswer, validatePixelGrid, type PixelGrid } from "./pixel";
import { renderPixels } from "./pixel-render.server";
import { assertNotArchived } from "./project-lifecycle.server";
import { runExportProcess } from "../modules/asset-builds/index.server";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const MAX_SOURCE = 200 * 1024 * 1024;
const put = (key: string, bytes: Uint8Array | string) => getStorage().upload(new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], { type: fileMimeType(key) }), key);

export async function materializeStartingPoint(source: StartingPoint) {
  const original = new Uint8Array(await (await readStoredFile(source.key)).arrayBuffer());
  if (digest(original) !== source.sha256) throw new Error("Starting point checksum mismatch");
  const key = ["blend", "glb"].includes(source.format) ? source.key : source.mesh ?? source.key;
  const bytes = Buffer.from(await (await readStoredFile(key)).arrayBuffer());
  const path = resolve(DATA, key);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, bytes);
  return path;
}

/** Resolve only receipts produced by the importer for this project; clients cannot forge derived keys. */
export async function validateStartingPoint(projectId: string, type: AssetType, input?: StartingPoint) {
  if (!input) return;
  const parsed = startingPointSchema.parse(input);
  if (!parsed.key.startsWith(`starting-points/${projectId}/`)) throw new Error("Starting point belongs to another project");
  const saved = startingPointSchema.parse(JSON.parse(await (await readStoredFile(parsed.key.replace(/source\.[^.]+$/, "receipt.json"))).text()));
  if (JSON.stringify(saved) !== JSON.stringify(parsed)) throw new Error("Starting point differs from its import receipt");
  startingPointExtension(saved.name, type);
  if (digest(new Uint8Array(await (await readStoredFile(saved.key)).arrayBuffer())) !== saved.sha256) throw new Error("Starting point checksum mismatch");
  return saved;
}

async function pixelImage(bytes: Buffer, format: string): Promise<PixelGrid> {
  if (format === "json") {
    const grid = resolvePixelAnswer(pixelGridSchema.parse(JSON.parse(bytes.toString("utf8"))));
    validatePixelGrid(grid); return grid;
  }
  const image = sharp(bytes, { animated: format === "gif", limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  const frames = metadata.pages ?? 1;
  if (frames > 8) throw new Error("Pixel starting points support up to 8 frames");
  const nativeWidth = metadata.width!, nativeHeight = metadata.pageHeight ?? metadata.height!;
  const scale = Math.min(1, 128 / Math.max(nativeWidth, nativeHeight));
  const width = Math.max(4, Math.round(nativeWidth * scale)), height = Math.max(4, Math.round(nativeHeight * scale));
  const images: Buffer[] = [];
  for (let frame = 0; frame < frames; frame++) images.push(await sharp(bytes, { page: frame, pages: 1 })
    .resize(width, height, { kernel: "nearest", fit: "fill" }).ensureAlpha().raw().toBuffer());
  const strip = await sharp(Buffer.concat(images), { raw: { width, height: height * frames, channels: 4 } })
    .threshold(128, { greyscale: false }).png().toBuffer();
  // Quantize color separately from alpha. A shared palette keeps all animation frames coherent.
  const colorStrip = await sharp(Buffer.concat(images), { raw: { width, height: height * frames, channels: 4 } })
    .png({ palette: true, colours: 31, dither: 0 }).toBuffer();
  const rgba = await sharp(colorStrip).ensureAlpha().raw().toBuffer();
  const alpha = await sharp(strip).ensureAlpha().raw().toBuffer();
  const palette = [{ key: ".", color: "transparent" }], keys = new Map<string, string>();
  const alphabet = "123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const rows: string[] = [];
  for (let y = 0; y < height * frames; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      if (alpha[at + 3] < 128) { row += "."; continue; }
      const color = `#${rgba.subarray(at, at + 3).toString("hex")}`;
      if (!keys.has(color)) { const key = alphabet[keys.size]; keys.set(color, key); palette.push({ key, color }); }
      row += keys.get(color);
    }
    rows.push(row);
  }
  return { width, height, palette, rows: rows.slice(0, height), ...(frames > 1 ? { frames: Array.from({ length: frames - 1 }, (_, i) => ({ rows: rows.slice((i + 1) * height, (i + 2) * height) })), fps: Math.max(1, Math.min(30, Math.round(1000 / (metadata.delay?.[0] || 125)))), loop: true } : {}) };
}

export async function importStartingPoint(projectId: string, type: AssetType, file: File, units: StartingPoint["units"]) {
  if (!file.size || file.size > MAX_SOURCE) throw new Error("Starting points must be between 1 byte and 200 MB");
  const format = startingPointExtension(file.name, type);
  if (["py", "svg", "json", "obj"].includes(format) && file.size > 8 * 1024 * 1024) throw new Error("Text starting points must be at most 8 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (["py", "svg", "json", "obj"].includes(format)) new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (format === "py" && bytes.length > 200000) throw new Error("CadQuery source must be at most 200,000 bytes");
  const base = `starting-points/${projectId}/${crypto.randomUUID()}`;
  const source: StartingPoint = { key: `${base}/source.${format}`, name: file.name.slice(0, 200), format, sha256: digest(bytes), units,
    mode: type === "cad" && ["stl", "glb", "obj", "blend"].includes(format) || type === "svg" && format !== "svg" ? "reconstruct" : "native" };
  // Validate/decode before publishing any source. Python is executed only by a queued CAD build.
  if (format === "py" && (!bytes.toString("utf8").trim() || bytes.includes(0))) throw new Error("Use a UTF-8 CadQuery Python script");
  if (["step", "stp"].includes(format) && !bytes.subarray(0, 256).toString("ascii").includes("ISO-10303-21")) throw new Error("Invalid STEP file");
  if (type === "pixel") {
    const grid = await pixelImage(bytes, format), rendered = await renderPixels(grid);
    source.grid = `${base}/grid.json`; source.preview = `${base}/preview.png`;
    await put(source.grid, JSON.stringify(grid)); await put(source.preview, rendered.preview);
  } else if (format === "svg") {
    const svg = validateSvg(bytes.toString("utf8"));
    source.preview = `${base}/preview.png`;
    await put(`${base}/editable.svg`, svg);
    await put(source.preview, await sharp(Buffer.from(svg), { limitInputPixels: 40_000_000 }).resize(1024, 1024, { fit: "inside" }).png().toBuffer());
  } else if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].includes(format)) {
    source.preview = `${base}/preview.png`;
    if (format === "bmp") {
      const root = resolve(DATA, base); await mkdir(root, { recursive: true });
      await writeFile(resolve(root, "source.bmp"), bytes);
      const python = process.env.STUDIO_PYTHON || resolve(process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python");
      await runExportProcess(python, [resolve("cad/convert_image.py"), resolve(root, "source.bmp"), resolve(root, "preview.png")], root, 60_000);
      await put(source.preview, await readFile(resolve(root, "preview.png")));
    } else await put(source.preview, await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).png().toBuffer());
  } else if (["glb", "blend", "stl", "obj"].includes(format)) {
    if (format === "glb" && bytes.subarray(0, 4).toString() !== "glTF") throw new Error("Invalid GLB file");
    if (format === "blend" && bytes.subarray(0, 7).toString() !== "BLENDER") throw new Error("Invalid Blender file");
    const root = resolve(DATA, base); await mkdir(root, { recursive: true });
    await writeFile(resolve(root, `source.${format}`), bytes);
    await runExportProcess(process.env.BLENDER_BIN || "blender", ["-b", "--factory-startup", "--python-exit-code", "1", "--python", resolve("cad/import_mesh.py"), "--", resolve(root, `source.${format}`), resolve(root, "input.glb"), units, type === "cad" ? "all" : "iso"], root, 180_000);
    source.mesh = `${base}/input.glb`; await put(source.mesh, await readFile(resolve(root, "input.glb")));
    source.views = (type === "cad" ? ["front", "rear", "left", "right", "top", "bottom", "iso"] : ["iso"]).map((view) => `${base}/${view}.png`);
    for (const key of source.views) await put(key, await readFile(resolve(DATA, key)));
    source.preview = `${base}/iso.png`;
  }
  await put(source.key, bytes); await put(`${base}/receipt.json`, JSON.stringify(source));
  return source;
}

export async function updateStartingPoint(project: typeof projects.$inferSelect, assetId: string, form: FormData) {
  assertNotArchived(project);
  const [asset] = await db.select().from(assetEntries).where(and(eq(assetEntries.id, assetId), eq(assetEntries.projectId, project.id)));
  if (!asset?.inIdea) throw new Error("Starting points can only be changed while an asset is in Ideas");
  const expected = String(form.get("expected") || "");
  if ((asset.input.startingPoint?.sha256 ?? "") !== expected) throw new Error("Starting point changed; reload before saving");
  let file = form.get("file");
  const sourceRunId = form.get("sourceRunId");
  if (sourceRunId) {
    const [saved] = await db.select().from(runs).where(and(eq(runs.id, String(sourceRunId)), eq(runs.projectId, project.id), eq(runs.status, "done")));
    const result = saved?.result as { key?: string; exports?: Record<string, string>; artifacts?: { blend?: string } } | null;
    const key = project.assetType === "cad" ? result?.exports?.step : project.assetType === "model" ? result?.artifacts?.blend : project.assetType === "pixel" ? result?.key?.replace(/pixel\.png$/, "grid.json") : result?.key;
    if (!key) throw new Error("Choose a completed compatible version from this project");
    file = new File([await readStoredFile(key)], key.split("/").pop()!);
  }
  const units = startingPointSchema.shape.units.parse(form.get("units") || "mm");
  const source = file instanceof File && file.size ? await importStartingPoint(project.id, project.assetType, file, units) : undefined;
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(assetEntries).where(eq(assetEntries.id, assetId)).for("update");
    if (!current?.inIdea || (current.input.startingPoint?.sha256 ?? "") !== expected) throw new Error("Starting point changed; reload before saving");
    await tx.update(assetEntries).set({ input: { ...current.input, startingPoint: source } }).where(eq(assetEntries.id, assetId));
  });
  return { startingPoint: source ?? null };
}

export async function startingPointVersions(project: typeof projects.$inferSelect) {
  const role = project.assetType === "model" ? "builder" : project.assetType;
  const saved = await db.select({ run: runs, name: assetVersions.name }).from(runs).innerJoin(assetVersions, eq(runs.modelId, assetVersions.id))
    .where(and(eq(runs.projectId, project.id), eq(runs.role, role), eq(runs.status, "done"))).orderBy(desc(runs.createdAt)).limit(100);
  return saved.filter(({ run }) => {
    const result = run.result as { key?: string; exports?: { script?: string }; artifacts?: { blend?: string } } | null;
    return project.assetType === "model" ? result?.artifacts?.blend : project.assetType === "cad" ? result?.exports?.script : result?.key;
  }).map(({ run, name }) => ({ id: run.id, label: `${name} · ${new Date(run.createdAt).toISOString()} · round ${run.iteration ?? 0}` }));
}
