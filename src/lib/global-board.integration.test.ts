import { expect, test } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { assetEntries, assetVersions, batches, projects } from "@/db/schema";
import { boardColumns } from "./board";
import { getGlobalBoard } from "./global-board.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration("global board keeps asset identity, project labels and project filtering", async () => {
  const projectId = crypto.randomUUID();
  const otherProjectId = crypto.randomUUID();
  const assetId = crypto.randomUUID();
  const draftId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const input = { prompt: "A stone lamp", count: 1, judgeIterations: 0, imageSize: "1024x1024" as const };
  try {
    await db.insert(projects).values([
      { id: projectId, name: "Board project", description: "fixture", status: "ready" },
      { id: otherProjectId, name: "Another project", description: "fixture", status: "ready" },
    ]);
    await db.insert(batches).values({ id: batchId, projectId, prompt: input.prompt, count: 1, judgeIterations: 0, design: "approved", designVersion: 1 });
    await db.insert(assetEntries).values([
      { id: assetId, projectId, title: "Stone lamp", input, inIdea: false, batchId },
      { id: draftId, projectId, title: "Draft lamp", input, inIdea: true, readyAt: new Date() },
    ]);
    await db.insert(assetVersions).values({ id: versionId, assetId, projectId, batchId, name: "Stone_lamp", prompt: input.prompt, status: "done" });
    const filtered = await getGlobalBoard(projectId);
    expect(filtered.projects).toHaveLength(1);
    expect(filtered.projects[0].project).toMatchObject({ id: projectId, name: "Board project" });
    expect(filtered.projects[0].ideas.map((asset) => asset.id)).toEqual([draftId]);
    expect(filtered.projects[0].models.map((version) => ({ id: version.id, assetId: version.assetId }))).toEqual([{ id: versionId, assetId }]);
    expect(filtered.projects[0].assets?.map((asset) => asset.id).sort()).toEqual([assetId, draftId].sort());
    await db.update(assetEntries).set({ inIdea: true }).where(eq(assetEntries.id, assetId));
    await db.update(batches).set({ status: "failed" }).where(eq(batches.id, batchId));
    const returned = (await getGlobalBoard(projectId)).projects[0];
    expect(returned.models).toEqual([]);
    expect(boardColumns(returned.ideas, returned.models, returned.batches).progress).toEqual([]);
    expect((await getGlobalBoard()).projects.some(({ project }) => project.id === otherProjectId)).toBe(true);
  } finally {
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
    await db.delete(assetEntries).where(eq(assetEntries.projectId, projectId));
    await db.delete(batches).where(eq(batches.projectId, projectId));
    await db.delete(projects).where(inArray(projects.id, [projectId, otherProjectId]));
  }
});

integration("Done board age uses the latest asset update and hides whole entries only", async () => {
  const { assetHistory } = await import("@/db/schema");
  const { loadRuntimeSettings, saveRuntimeSettings, RUNTIME_SETTINGS_PATH } = await import("./runtime-settings.server");
  const previousSettings = await readFile(RUNTIME_SETTINGS_PATH).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  const settings = await loadRuntimeSettings();
  const projectId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const versionIds = Array.from({ length: 5 }, () => crypto.randomUUID());
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
  const input = { prompt: "A stone lamp", count: 1, judgeIterations: 0, imageSize: "1024x1024" as const };
  const board = async () => (await getGlobalBoard(projectId)).projects[0];
  try {
    await saveRuntimeSettings({ ...settings, boardDoneHideAfterDays: 5 });
    await db.insert(projects).values({ id: projectId, name: "Done age fixture", description: "fixture", status: "ready" });
    await db.insert(batches).values({ id: batchId, projectId, prompt: input.prompt, count: 4, judgeIterations: 0, design: "approved", designVersion: 1 });
    await db.insert(assetEntries).values(ids.map((id) => ({ id, projectId, title: "Lamp", input, inIdea: false, batchId, createdAt: daysAgo(20) })));
    await db.insert(assetVersions).values(versionIds.map((id, index) => ({
      id, projectId, batchId, assetId: ids[Math.min(index, 3)], name: `Lamp_${index}`, prompt: input.prompt,
      status: index === 2 ? "building" : "done", createdAt: daysAgo(index === 4 ? 10 : 20),
      acceptedAt: index === 1 || index === 2 ? null : daysAgo(6),
      parentModelId: index === 4 ? versionIds[3] : null,
      branchKind: index === 4 ? "iterate" as const : null,
    })));
    await db.update(assetHistory).set({ createdAt: daysAgo(6) }).where(inArray(assetHistory.assetId, ids));
    let entry = await board();
    expect(boardColumns(entry.ideas, entry.models, entry.batches).done).toHaveLength(0);
    expect(entry.models.map((version) => version.id).sort()).toEqual([versionIds[1], versionIds[2]].sort());
    expect(entry.assets).toHaveLength(4);
    expect(boardColumns(entry.ideas, entry.models, entry.batches).progress.filter((card) => card.kind === "pending")).toHaveLength(0);
    expect((await db.select().from(assetVersions).where(eq(assetVersions.projectId, projectId)))).toHaveLength(5);

    await saveRuntimeSettings({ ...settings, boardDoneHideAfterDays: 10 });
    entry = await board();
    expect(boardColumns(entry.ideas, entry.models, entry.batches).done.map((card) => card.asset.id).sort()).toEqual([versionIds[0], versionIds[4]].sort());
    await saveRuntimeSettings({ ...settings, boardDoneHideAfterDays: 0 });
    expect((await board()).models).toHaveLength(5);
    await saveRuntimeSettings({ ...settings, boardDoneHideAfterDays: 5 });

    await db.update(assetEntries).set({ title: "Renamed lamp" }).where(eq(assetEntries.id, ids[0]));
    entry = await board();
    expect(boardColumns(entry.ideas, entry.models, entry.batches).done.map((card) => card.asset.id)).toEqual([versionIds[0]]);
    await db.update(assetVersions).set({ acceptedAt: new Date() }).where(eq(assetVersions.id, versionIds[4]));
    entry = await board();
    expect(boardColumns(entry.ideas, entry.models, entry.batches).done).toHaveLength(2);
    expect((await getGlobalBoard()).projects.find(({ project }) => project.id === projectId)?.models).toHaveLength(5);
  } finally {
    // Preserve absence too: writing defaults would override later environment settings.
    if (previousSettings === undefined) await rm(RUNTIME_SETTINGS_PATH, { force: true });
    else await writeFile(RUNTIME_SETTINGS_PATH, previousSettings);
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
    await db.delete(assetEntries).where(eq(assetEntries.projectId, projectId));
    await db.delete(batches).where(eq(batches.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
});
