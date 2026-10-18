import { expect, test } from "bun:test";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { assetEntries, assetVersions, batches, jobs, projects } from "../db/schema";
import { ideaInput } from "./api-inputs";
import { createAsset, startAsset } from "./assets.server";
import { importStartingPoint, updateStartingPoint, validateStartingPoint } from "./starting-point.server";
import { getStorage } from "./storage.server";
import { api } from "./api.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#284e3c"/></svg>';

integration("starting points are owned, validated and frozen with a generation; replacing an idea preserves prior sources", async () => {
  const id = crypto.randomUUID();
  const [project] = await db.insert(projects).values({ id, name: "Source fixture", description: "test", assetType: "svg", status: "ready", design: "Green circles", designVersion: 1 }).returning();
  try {
    const listed = await api(new Request(`http://localhost/api/projects/${id}/starting-points`));
    expect(await listed.json()).toEqual({ sources: [] });
    const asset = await createAsset(project, ideaInput.parse({ title: "Circle", prompt: "Make the circle wider", judgeIterations: 0 }));
    const upload = new FormData(); upload.set("file", new File([svg], "circle.svg"));
    const { startingPoint: source } = await updateStartingPoint(project, asset.id, upload);
    expect(source?.format).toBe("svg");
    expect(await validateStartingPoint(id, "svg", source!)).toEqual(source!);
    await expect(validateStartingPoint(crypto.randomUUID(), "svg", source!)).rejects.toThrow("another project");
    await expect(validateStartingPoint(id, "svg", { ...source!, preview: "references/forged.png" })).rejects.toThrow("receipt");
    const batchId = await startAsset(id, asset.id);
    const [batch] = await db.select().from(batches).where(eq(batches.id, batchId));
    expect(batch.workshop?.startingPoint).toEqual(source!);
    await expect(updateStartingPoint(project, asset.id, upload)).rejects.toThrow("Ideas");
    await db.update(assetEntries).set({ inIdea: true }).where(eq(assetEntries.id, asset.id));
    upload.set("expected", source!.sha256); upload.set("file", new File([svg.replace('r="8"', 'r="6"')], "smaller.svg"));
    const replaced = await updateStartingPoint(project, asset.id, upload);
    expect(replaced.startingPoint?.sha256).not.toBe(source!.sha256);
    expect(await getStorage().exists(source!.key)).toBe(true);
    const [frozen] = await db.select().from(batches).where(eq(batches.id, batchId));
    expect(frozen.workshop?.startingPoint).toEqual(source!);
    await expect(updateStartingPoint(project, asset.id, upload)).rejects.toThrow("changed");
  } finally {
    for (const key of await getStorage().list(`starting-points/${id}/`)) await getStorage().delete(key);
    const owned = await db.select().from(batches).where(eq(batches.projectId, id));
    for (const batch of owned) await db.delete(jobs).where(eq(jobs.targetId, batch.id));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, id));
    await db.delete(assetEntries).where(eq(assetEntries.projectId, id));
    await db.delete(batches).where(eq(batches.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});

integration("raster sources normalize for vector edits and pixel sources retain a drawable grid", async () => {
  const id = crypto.randomUUID();
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: "#284e3c" } }).png().toBuffer();
  try {
    const vector = await importStartingPoint(id, "svg", new File([png], "source.png"), "mm");
    expect(vector.mode).toBe("reconstruct"); expect(vector.preview).toBeDefined();
    const pixel = await importStartingPoint(id, "pixel", new File([png], "source.png"), "mm");
    const grid = JSON.parse(await (await getStorage().download(pixel.grid!)).text());
    expect(grid).toMatchObject({ width: 16, height: 16 });
    expect(new Set(grid.rows.join("")).size).toBe(1);
    expect(grid.palette).toContainEqual({ key: "1", color: "#284e3c" });
    await expect(importStartingPoint(id, "svg", new File(['<svg><script>alert(1)</script></svg>'], "bad.svg"), "mm")).rejects.toThrow();
    const script = await importStartingPoint(id, "cad", new File(['raise RuntimeError("must not execute at upload")'], "part.py"), "mm");
    expect(script.format).toBe("py");
    await expect(importStartingPoint(id, "cad", new File([png], "part.png"), "mm")).rejects.toThrow("support");
  } finally { for (const key of await getStorage().list(`starting-points/${id}/`)) await getStorage().delete(key); }
});
