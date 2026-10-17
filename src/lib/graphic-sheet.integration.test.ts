import { test, expect } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, models, jobs } from "../db/schema";
import { jobContext } from "./checkpoint.server";
import { settleBatch } from "./batch-state.server";
import { executeJob } from "./pipeline.server";
import { getStorage } from "./storage.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const svg = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="${fill}"/></svg>`;

async function batchOf(count: number) {
  const projectId = crypto.randomUUID(), batchId = crypto.randomUUID();
  await db.insert(projects).values({ id: projectId, name: "Sheet fixture", description: "test", assetType: "svg", status: "ready" });
  await db.insert(batches).values({ id: batchId, projectId, prompt: "circles", count, judgeIterations: 0, design: "d", designVersion: 1, status: "building" });
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const key = `graphics/${crypto.randomUUID()}/${crypto.randomUUID()}/graphic.svg`;
    await getStorage().upload(new Blob([svg(i ? "#8a5a3c" : "#284e3c")], { type: "image/svg+xml" }), key);
    keys.push(key);
    await db.insert(models).values({
      id: crypto.randomUUID(), projectId, batchId, name: `Circle ${i + 1}`, prompt: "p", status: "done",
      artifacts: { image: key, stage: "final", format: "svg" },
    });
  }
  const cleanup = async (extra: string[] = []) => {
    for (const key of [...keys, ...extra]) if (await getStorage().exists(key)) await getStorage().delete(key);
    await db.delete(jobs).where(inArray(jobs.targetId, [projectId, batchId]));
    await db.delete(models).where(eq(models.projectId, projectId));
    await db.delete(batches).where(eq(batches.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  };
  return { projectId, batchId, cleanup };
}

integration("a finished graphic batch renders one collection sheet through the demo job", async () => {
  const t = await batchOf(3);
  let sheet = "";
  try {
    await settleBatch(t.batchId);
    expect((await db.select().from(batches).where(eq(batches.id, t.batchId)))[0].status).toBe("rendering");
    const [demo] = await db.select().from(jobs).where(eq(jobs.targetId, t.batchId));
    expect(demo).toMatchObject({ kind: "demo", status: "queued" });
    await jobContext.run({ id: demo.id, checkpoint: {} }, () => executeJob("demo", t.batchId));
    const [batch] = await db.select().from(batches).where(eq(batches.id, t.batchId));
    expect(batch.status).toBe("done");
    sheet = (batch.preview as { sheet: string }).sheet;
    expect(sheet).toMatch(new RegExp(`^collections/${t.batchId}/.+/sheet\\.png$`));
    expect(await getStorage().exists(sheet)).toBe(true);
  } finally {
    await t.cleanup(sheet ? [sheet] : []);
  }
});

integration("a single-asset graphic batch finishes without a sheet", async () => {
  const t = await batchOf(1);
  try {
    await settleBatch(t.batchId);
    expect((await db.select().from(batches).where(eq(batches.id, t.batchId)))[0].status).toBe("done");
    expect(await db.select().from(jobs).where(eq(jobs.targetId, t.batchId))).toEqual([]);
  } finally {
    await t.cleanup();
  }
});
