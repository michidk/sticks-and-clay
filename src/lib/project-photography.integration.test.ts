import { test, expect } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, assetVersions, runs, jobs } from "../db/schema";
import { jobContext } from "./checkpoint.server";
import {
  photographProject,
  projectPhotographs,
} from "./project-photography.server";
import { DATA, getStorage } from "./storage.server";
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;

integration(
  "project photograph snapshots models across batches, retains history and replays without another request",
  async () => {
    const id = crypto.randomUUID(),
      jobId = crypto.randomUUID(),
      runId = crypto.randomUUID();
    const directory = `project-photographs/${id}/${jobId}`;
    const key = `test-photo/${id}/asset.glb`;
    const context = {
      id: jobId,
      checkpoint: { "agent:photographer:0": runId } as Record<string, string>,
    };
    const bytes = Buffer.from("fixture GLB " + id);
    const hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
    const png = Buffer.alloc(32);
    Buffer.from("89504e470d0a1a0a", "hex").copy(png);
    png.writeUInt32BE(1024, 16);
    png.writeUInt32BE(1024, 20);
    await db
      .insert(projects)
      .values({ id, name: "Project photo fixture", description: "test" });
    await db.insert(jobs).values({
      id: jobId,
      kind: "project-photo",
      targetId: id,
      status: "done",
      checkpoint: context.checkpoint,
    });
    await db.insert(runs).values({
      id: runId,
      projectId: id,
      role: "photographer",
      engine: "eve",
      status: "done",
      model: "fixture",
      promptVersion: "test",
      systemPrompt: "test",
      input: "test",
      result: { summary: "test", limitations: [] },
      rates: { input: 0, cached: 0, output: 0, source: "test" },
    });
    try {
      let originalModelId = "";
      for (let i = 0; i < 2; i++) {
        const batchId = crypto.randomUUID();
        await db.insert(batches).values({
          id: batchId,
          projectId: id,
          prompt: "test",
          count: 1,
          judgeIterations: 0,
          design: "test",
          designVersion: 1,
        });
        const modelId = crypto.randomUUID();
        if (i === 0) originalModelId = modelId;
        await db.insert(assetVersions).values({
          id: modelId,
          projectId: id,
          batchId,
          name: `model${i}`,
          prompt: "test",
          artifacts: { glb: key, stage: i ? "geometry" : "complete" },
        });
      }
      const iterationBatchId = crypto.randomUUID();
      const iterationModelId = crypto.randomUUID();
      await db.insert(batches).values({
        id: iterationBatchId,
        projectId: id,
        prompt: "iteration",
        count: 1,
        judgeIterations: 0,
        design: "test",
        designVersion: 1,
      });
      await db.insert(assetVersions).values({
        id: iterationModelId,
        projectId: id,
        batchId: iterationBatchId,
        name: "model0",
        prompt: "iteration",
        parentModelId: originalModelId,
        branchKind: "iterate",
        status: "done",
        artifacts: { glb: key, stage: "complete" },
      });
      await mkdir(resolve(DATA, `test-photo/${id}`), { recursive: true });
      await writeFile(resolve(DATA, key), bytes);
      await mkdir(resolve(DATA, directory), { recursive: true });
      for (const view of ["front", "rear", "detail"])
        await writeFile(resolve(DATA, directory, `${view}.png`), png);
      await writeFile(
        resolve(DATA, directory, "photography.json"),
        JSON.stringify({
          assets: {
            [resolve(DATA, key)]: hash(bytes),
            [resolve(
              DATA,
              `versions/project-snapshot-${hash(bytes)}/asset.glb`,
            )]: hash(bytes),
          },
          images: Object.fromEntries(
            ["front", "rear", "detail"].map((v) => [v, hash(png)]),
          ),
        }),
      );
      await jobContext.run(context, () => photographProject(id));
      const history = await projectPhotographs(id);
      expect(history).toHaveLength(1);
      expect(history[0].assets).toHaveLength(2);
      expect(history[0].thumbnail).toBe(`${directory}/front.png`);
      await jobContext.run(context, () => photographProject(id));
      expect(await projectPhotographs(id)).toHaveLength(1);
      const snapshot = JSON.parse(context.checkpoint["project-photo-input"]);
      expect(snapshot.assets).toHaveLength(2);
      expect(snapshot.assets.map((asset: any) => asset.modelId)).toContain(
        iterationModelId,
      );
      expect(snapshot.assets.map((asset: any) => asset.modelId)).not.toContain(
        originalModelId,
      );
      expect(snapshot.assets[0].renderGlb).toContain(
        "versions/project-snapshot-",
      );
      // Failed work must never displace a previously published cover.
      await db.update(runs).set({ status: "failed" }).where(eq(runs.id, runId));
      expect(await projectPhotographs(id)).toEqual([]);
    } finally {
      await db.delete(jobs).where(eq(jobs.id, jobId));
      await db.delete(runs).where(eq(runs.projectId, id));
      await db.delete(assetVersions).where(eq(assetVersions.projectId, id));
      await db.delete(batches).where(eq(batches.projectId, id));
      await db.delete(projects).where(eq(projects.id, id));
      for (const key of await getStorage().list(`project-photographs/${id}`))
        await getStorage().delete(key);
      await rm(resolve(DATA, `project-photographs/${id}`), {
        recursive: true,
        force: true,
      });
      const frozenKey = `versions/project-snapshot-${hash(bytes)}/asset.glb`;
      await getStorage().delete(frozenKey);
      await rm(resolve(DATA, `versions/project-snapshot-${hash(bytes)}`), {
        recursive: true,
        force: true,
      });
      await rm(resolve(DATA, `test-photo/${id}`), {
        recursive: true,
        force: true,
      });
      if (context.checkpoint["capability:project-photo"])
        await rm(
          resolve(
            DATA,
            "capabilities",
            context.checkpoint["capability:project-photo"] + ".json",
          ),
          { force: true },
        );
    }
  },
);
