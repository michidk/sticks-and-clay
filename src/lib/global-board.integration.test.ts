import { expect, test } from "bun:test";
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
