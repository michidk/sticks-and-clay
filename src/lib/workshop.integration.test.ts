import { test, expect } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { projects, batches, jobs, models, runs } from "../db/schema";
import { api } from "./api.server";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { DATA, getStorage } from "./storage.server";
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const send = (path: string, body: unknown, method = "POST") =>
  api(
    new Request(`http://localhost/api/${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
integration(
  "imports, current-style forks and presentation cancellation preserve saved versions",
  async () => {
    const projectId = crypto.randomUUID(),
      batchId = crypto.randomUUID(),
      modelId = crypto.randomUUID(),
      runId = crypto.randomUUID();
    const guidance = {
      version: 1,
      memory: "Preserve socket axes",
      style: "Sage matte",
      variation: 10,
      effort: "quick" as const,
      exampleRunIds: [runId],
    };
    await db.insert(projects).values({
      id: projectId,
      name: "Workflow fixture",
      description: "test",
      status: "ready",
      design: "Approved original",
      designVersion: 1,
      workshop: guidance,
    });
    await db.insert(batches).values({
      id: batchId,
      projectId,
      prompt: "prop",
      count: 1,
      judgeIterations: 0,
      design: "Approved original",
      designVersion: 1,
    });
    await db.insert(models).values({
      id: modelId,
      projectId,
      batchId,
      name: "Saved prop",
      prompt: "prop",
      status: "done",
    });
    const source = {
      artifacts: {
        glb: "fixtures/saved.glb",
        blend: "fixtures/saved.blend",
        renders: [],
        metrics: { triangles: 24 },
      },
    };
    await db.insert(runs).values({
      id: runId,
      projectId,
      modelId,
      role: "builder",
      status: "done",
      model: "fixture",
      promptVersion: "test",
      systemPrompt: "test",
      input: "test",
      rates: { input: 0, output: 0, cached: 0, source: "test" },
      result: source,
    });
    let importedKey: string | undefined;
    try {
      const fork = await send(`models/${modelId}/branch`, {
        kind: "iterate",
        sourceRunId: runId,
        prompt: "Match current collection style",
        judgeIterations: 0,
        useCurrentStyle: true,
      });
      expect(fork.status).toBe(201);
      const [variant] = await db
        .select()
        .from(models)
        .where(eq(models.id, (await fork.json()).id));
      const [newBatch] = await db
        .select()
        .from(batches)
        .where(eq(batches.id, variant.batchId));
      expect(newBatch.workshop?.style).toBe("Sage matte");
      expect(newBatch.workshop?.examples?.[0].name).toBe("Saved prop");
      expect(newBatch.workshop?.examples?.[0].metrics).toEqual({
        triangles: 24,
      });
      expect(newBatch.design).toBe("Approved original");
      const presentation = await send(`models/${modelId}/presentation`, {
        sourceRunId: runId,
        sprites: true,
        spriteOptions: {
          pixel: true,
          colors: 4,
          directions: 1,
          size: 32,
          frameCount: 2,
        },
      });
      expect(presentation.status).toBe(201);
      const renderId = (await presentation.json()).id;
      const queue = await api(new Request("http://localhost/api/queue"));
      expect(
        (await queue.json()).jobs.find((job: any) => job.id === renderId).name,
      ).toBe("Saved version render · Saved prop");
      expect((await send(`queue/${renderId}/cancel`, {})).status).toBe(200);
      const status = await api(
        new Request(`http://localhost/api/workshop-jobs/${renderId}`),
      );
      expect((await status.json()).status).toBe("cancelled");
      const [unchanged] = await db
        .select()
        .from(models)
        .where(eq(models.id, modelId));
      expect(unchanged.status).toBe("done");
      const [savedRun] = await db.select().from(runs).where(eq(runs.id, runId));
      expect(savedRun.result).toEqual(source);
      await db
        .update(jobs)
        .set({ status: "failed" })
        .where(eq(jobs.id, renderId));
      expect((await send(`queue/${renderId}/resume`, {})).status).toBe(200);
      const [resumed] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, renderId));
      expect(resumed.checkpoint.sourceRunId).toBe(runId);
      expect(resumed.checkpoint.sprites).toBe("true");
      expect(JSON.parse(resumed.checkpoint.spriteOptions).pixel).toBe(true);

      const bytes = Buffer.alloc(24);
      bytes.write("glTF");
      bytes.writeUInt32LE(2, 4);
      bytes.writeUInt32LE(bytes.length, 8);
      bytes.writeUInt32LE(4, 12);
      bytes.writeUInt32LE(0x4e4f534a, 16);
      bytes.write("{}  ", 20);
      const form = new FormData();
      form.set("file", new File([bytes], "input.glb"));
      form.set("name", "Imported prop");
      form.set("prompt", "Preserve hierarchy and change the paint");
      const imported = await api(
        new Request(`http://localhost/api/projects/${projectId}/import`, {
          method: "POST",
          body: form,
        }),
      );
      expect(imported.status).toBe(201);
      const [job] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.targetId, (await imported.json()).id));
      importedKey = job.checkpoint["import-baseline"];
      expect(await readFile(resolve(DATA, importedKey))).toEqual(bytes);
      expect(job.kind).toBe("model");
      const [baseline] = await db
        .select()
        .from(models)
        .where(eq(models.id, job.targetId));
      const [importBatch] = await db
        .select()
        .from(batches)
        .where(eq(batches.id, baseline.batchId));
      expect(importBatch.workshop?.memory).toBe(guidance.memory);
      expect(importBatch.design).toBe("Approved original");
    } finally {
      const assets = await db
        .select()
        .from(models)
        .where(eq(models.projectId, projectId));
      await db.delete(jobs).where(
        inArray(
          jobs.targetId,
          assets.map((asset) => asset.id),
        ),
      );
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(models).where(eq(models.projectId, projectId));
      await db.delete(batches).where(eq(batches.projectId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
      if (importedKey) {
        await getStorage().delete(importedKey);
        await rm(resolve(DATA, importedKey), { force: true });
      }
    }
  },
);
integration(
  "memory edits are optimistic and future batches freeze style examples and effort",
  async () => {
    const projectId = crypto.randomUUID();
    await db.insert(projects).values({
      id: projectId,
      name: "Workshop fixture",
      description: "test",
      design: "Approved design",
      designVersion: 1,
      status: "ready",
    });
    try {
      const update = await send(
        `projects/${projectId}/workshop`,
        {
          version: 0,
          memory: "First lesson",
          style: "Quiet matte forms",
          effort: "thorough",
        },
        "PUT",
      );
      expect(update.status).toBe(200);
      expect(
        (
          await send(
            `projects/${projectId}/workshop`,
            { version: 0, memory: "Stale edit" },
            "PUT",
          )
        ).status,
      ).toBe(400);
      const response = await send(`projects/${projectId}/generate`, {
        count: 1,
        judgeIterations: 0,
      });
      expect(response.status).toBe(201);
      const { id } = await response.json();
      expect(
        (
          await send(
            `projects/${projectId}/workshop`,
            { version: 1, memory: "New lesson", effort: "quick" },
            "PUT",
          )
        ).status,
      ).toBe(200);
      const [batch] = await db.select().from(batches).where(eq(batches.id, id));
      expect(batch.workshop?.memory).toBe("First lesson");
      expect(batch.workshop?.effort).toBe("thorough");
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId));
      expect(project.workshop?.memory).toBe("New lesson");
      expect(
        (
          await send(
            `projects/${projectId}/workshop`,
            { version: 2, exampleRunIds: [crypto.randomUUID()] },
            "PUT",
          )
        ).status,
      ).toBe(400);
    } finally {
      const rows = await db
        .select()
        .from(batches)
        .where(eq(batches.projectId, projectId));
      if (rows.length)
        await db.delete(jobs).where(
          inArray(
            jobs.targetId,
            rows.map((b) => b.id),
          ),
        );
      await db.delete(batches).where(eq(batches.projectId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
);
for (const assetType of ["graphic", "svg"] as const) integration(
  `${assetType} variants retain the actual source as an edit reference and reject judge rounds`,
  async () => {
    const projectId = crypto.randomUUID(),
      batchId = crypto.randomUUID(),
      modelId = crypto.randomUUID(),
      runId = crypto.randomUUID();
    await db.insert(projects).values({
      id: projectId,
      name: "Graphic fixture",
      description: "test",
      assetType,
      design: "Approved graphic design",
      designVersion: 1,
      status: "ready",
    });
    await db.insert(batches).values({
      id: batchId,
      projectId,
      prompt: "icon",
      count: 1,
      imageSize: "1536x1024",
      judgeIterations: 0,
      design: "Approved graphic design",
      designVersion: 1,
    });
    await db.insert(models).values({
      id: modelId,
      projectId,
      batchId,
      name: "Icon",
      prompt: "A simple icon",
      status: "done",
    });
    await db.insert(runs).values({
      id: runId,
      projectId,
      modelId,
      role: assetType,
      engine: assetType === "svg" ? "tanstack" : "imagegen",
      status: "done",
      model: "fixture",
      promptVersion: "test",
      systemPrompt: "test",
      input: "test",
      rates: { input: 0, output: 0, cached: 0, source: "test" },
      result: { key: `graphics/source.${assetType === "svg" ? "svg" : "png"}` },
    });
    try {
      expect(
        (
          await send(`models/${modelId}/branch`, {
            kind: "fork",
            sourceRunId: runId,
            name: "Wrong",
            prompt: "change palette",
            judgeIterations: 1,
          })
        ).status,
      ).toBe(400);
      const response = await send(`models/${modelId}/branch`, {
        kind: "fork",
        sourceRunId: runId,
        name: "Variant",
        prompt: "change palette",
        judgeIterations: 0,
      });
      expect(response.status).toBe(201);
      const { id } = await response.json();
      const [job] = await db.select().from(jobs).where(eq(jobs.targetId, id));
      expect(JSON.parse(job.checkpoint["branch-references"])[0]).toBe(
        `graphics/source.${assetType === "svg" ? "svg" : "png"}`,
      );
      const [variant] = await db.select().from(models).where(eq(models.id, id));
      expect(variant.sourceRunId).toBe(runId);
      const [variantBatch] = await db
        .select()
        .from(batches)
        .where(eq(batches.id, variant.batchId));
      expect(variantBatch.imageSize).toBe("1536x1024");
    } finally {
      const ms = await db
        .select()
        .from(models)
        .where(eq(models.projectId, projectId));
      await db.delete(jobs).where(
        inArray(
          jobs.targetId,
          ms.map((m) => m.id),
        ),
      );
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(models).where(eq(models.projectId, projectId));
      await db.delete(batches).where(eq(batches.projectId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
);
