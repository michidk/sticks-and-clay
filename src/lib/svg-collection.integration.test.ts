import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, assetEntries, assetVersions, runs, jobs } from "../db/schema";
import { jobContext } from "./checkpoint.server";
import { renderGraphicSheet } from "./graphic-sheet.server";
import { getStorage } from "./storage.server";
import { workshopSchema } from "./workshop";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration.each([[0, undefined], [2, undefined], [2, "logo"], [2, "illustration"]] as const)("SVG collection review resumes without duplicate calls; review rounds=%s, intent=%s", async (judgeIterations, svgIntent) => {
  const projectId = crypto.randomUUID(), batchId = crypto.randomUUID(), jobId = crypto.randomUUID(), runId = crypto.randomUUID();
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const directory = `collections/${batchId}/test`;
  const keys = ids.map((id) => `graphics/${id}/graphic.svg`);
  const checkpoint = { "graphic-sheet-directory": directory, "step:svg-collection-review": runId };
  const storage = getStorage();
  await db.insert(projects).values({ id: projectId, name: "Icons", description: "test", assetType: "svg" });
  await db.insert(batches).values({ id: batchId, projectId, prompt: "Two icons", count: 2, judgeIterations, design: "24px green icons", designVersion: 1, status: "rendering", ...(svgIntent ? { workshop: { ...workshopSchema.parse({}), svgIntent } } : {}) });
  await db.insert(jobs).values({ id: jobId, kind: "demo", targetId: batchId, status: "running", checkpoint });
  await db.insert(runs).values({ id: runId, projectId, batchId, role: "svg-collection-judge", engine: "tanstack", status: "done", model: "fixture", promptVersion: "test", systemPrompt: "test", input: "test", rates: { input: 0, output: 0, cached: 0, source: "test" },
    result: { passed: true, score: 60, summary: "Second icon has inconsistent weight", improvements: [{ priority: "major", issue: "Second is heavier than First", action: "Use a 2-unit stroke", view: "collection" }] } });
  try {
    for (const [index, id] of ids.entries()) {
      await storage.upload(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="green"/></svg>']), keys[index]);
      await db.insert(assetVersions).values({ id, projectId, batchId, name: `Icon ${index}`, prompt: "Green icon", status: "done", verdict: "approved", artifacts: { image: keys[index], format: "svg" } });
    }
    for (let i = 0; i < 2; i++) await jobContext.run({ id: jobId, checkpoint }, () => renderGraphicSheet(batchId));
    const [batch] = await db.select().from(batches).where(eq(batches.id, batchId));
    expect(batch.status).toBe(judgeIterations ? "completed_with_errors" : "done");
    expect(batch.error).toBe(judgeIterations ? "Collection review: Second icon has inconsistent weight" : null);
    expect(batch.preview).toEqual({ sheet: `${directory}/sheet.png` });
    // Icons are reviewed at 24 and 16 px, logos down to 16 px, illustrations only at 64 px.
    expect(await storage.exists(`${directory}/sheet-24.png`)).toBe(Boolean(judgeIterations) && !svgIntent);
    expect(await storage.exists(`${directory}/sheet-16.png`)).toBe(Boolean(judgeIterations) && svgIntent !== "illustration");
    expect(await db.select().from(runs).where(eq(runs.batchId, batchId))).toHaveLength(1);
    expect((await db.select().from(assetVersions).where(eq(assetVersions.batchId, batchId))).every((v) => v.verdict === "approved" && !v.acceptedAt)).toBe(true);
  } finally {
    for (const key of [...keys, ...["sheet.png", "sheet-64.png", "sheet-24.png", "sheet-16.png"].map((name) => `${directory}/${name}`)]) if (await storage.exists(key)) await storage.delete(key);
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(assetVersions).where(inArray(assetVersions.id, ids));
    await db.delete(assetEntries).where(eq(assetEntries.projectId, projectId));
    await db.delete(batches).where(eq(batches.id, batchId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
});
