import { expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../db/client";
import { assetEntries, assetVersions, batches, events, jobs, projects, runs } from "../db/schema";
import { jobContext } from "./checkpoint.server";
import { executeAssetVersionJob } from "./model-pipeline.server";
import { DATA } from "./storage.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFcAAAAASUVORK5CYII=", "base64");

integration("multipart versions review every file, resume without regeneration and revise the selected source parts", async () => {
  const projectId = crypto.randomUUID(), modelId = crypto.randomUUID(), batchId = crypto.randomUUID(), jobId = crypto.randomUUID();
  const nextId = crypto.randomUUID(), nextBatchId = crypto.randomUUID(), nextJobId = crypto.randomUUID();
  const parts = [{ name: "Static base", brief: "Fixed square socket" }, { name: "Moving lever", brief: "Separate movable handle" }];
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY, originalBase = process.env.OPENAI_BASE_URL;
  const requests: { prompt: string; images: Uint8Array[] }[] = [];
  let interrupt = true;
  let providerRequests = 0;
  try {
    process.env.OPENAI_API_KEY = "multipart-test-fixture";
    process.env.OPENAI_BASE_URL = "https://multipart.invalid/v1";
    await db.insert(projects).values({ id: projectId, name: "Multipart fixture", description: "test", assetType: "graphic", status: "ready" });
    const workshop = { version: 1, variation: 25, effort: "standard" as const, references: [], parts };
    await db.insert(batches).values({ id: batchId, projectId, prompt: "switch", count: 1, judgeIterations: 2,
      design: "Forest-green wall switch", designVersion: 1, workshop, status: "building" });
    await db.insert(assetVersions).values({ id: modelId, projectId, batchId, name: "Switch", prompt: "Two-part wall switch" });
    const checkpoint: Record<string, string> = {};
    for (const iteration of [0, 1]) {
      const id = crypto.randomUUID();
      checkpoint[`step:judge:${iteration}`] = id;
      await db.insert(runs).values({ id, projectId, batchId, modelId, role: "graphic-judge", engine: "tanstack", status: "done",
        iteration, model: "fixture", promptVersion: "test", systemPrompt: "test", input: "test",
        rates: { input: 0, output: 0, cached: 0, source: "test" },
        result: { passed: iteration === 1, score: iteration ? 90 : 50, summary: "Review all named parts",
          improvements: iteration ? [] : [{ priority: "major", issue: "Lever too short", action: "Lengthen the Moving lever", view: "Moving lever" }] },
      });
    }
    await db.insert(jobs).values({ id: jobId, kind: "model", targetId: modelId, status: "running", checkpoint });
    globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
      providerRequests++;
      if (interrupt && requests.length === 1) {
        interrupt = false;
        throw new Error("Interrupted between named parts");
      }
      const images: Uint8Array[] = [];
      let prompt: string;
      if (init?.body instanceof FormData) {
        prompt = String(init.body.get("prompt"));
        for (const image of init.body.getAll("image[]")) {
          if (!(image instanceof Blob)) throw new Error("Expected image attachment");
          images.push(new Uint8Array(await image.arrayBuffer()));
        }
      } else {
        prompt = JSON.parse(String(init?.body)).prompt;
      }
      requests.push({ prompt, images });
      const data = Buffer.concat([png, Buffer.from(`fixture-${requests.length}`)]);
      return Response.json({ data: [{ b64_json: data.toString("base64") }], usage: { input_tokens: 1, output_tokens: 2 } });
    }, { preconnect: originalFetch.preconnect });
    const execute = () => jobContext.run({ id: jobId, checkpoint }, () => executeAssetVersionJob(modelId));
    await expect(execute()).rejects.toThrow("Interrupted between named parts");
    await execute();
    await execute();
    expect(providerRequests).toBe(5);
    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.prompt.match(/Generate only part "([^"]+)"/)?.[1]))
      .toEqual(["Static base", "Moving lever", "Static base", "Moving lever"]);
    expect(Buffer.from(requests[2].images[0])).toEqual(Buffer.concat([png, Buffer.from("fixture-1")]));
    expect(Buffer.from(requests[3].images[0])).toEqual(Buffer.concat([png, Buffer.from("fixture-2")]));
    const [version] = await db.select().from(assetVersions).where(eq(assetVersions.id, modelId));
    expect(version).toMatchObject({ status: "done", verdict: "approved", artifacts: { parts: parts.map(({ name }) => ({ name })) } });
    const builders = await db.select().from(runs).where(and(eq(runs.modelId, modelId), eq(runs.role, "graphic"), eq(runs.status, "done")));
    expect(builders).toHaveLength(4);
    expect(builders.map((run) => run.result)).toMatchObject(builders.map(() => ({ parts: parts.map(({ name }) => ({ name })) })));
    const source = builders.find((run) => run.iteration === 0 && run.input.includes('Generate only part "Static base"'));
    if (!source) throw new Error("Missing primary source run");
    expect(source.result).toMatchObject({ parts: parts.map(({ name }) => ({ name })) });
    await db.insert(batches).values({ id: nextBatchId, projectId, prompt: "switch revised", count: 1, judgeIterations: 0,
      design: "Forest-green wall switch", designVersion: 1, workshop, status: "building" });
    await db.insert(assetVersions).values({ id: nextId, assetId: version.assetId, projectId, batchId: nextBatchId,
      name: "Switch", prompt: "Widen the socket", parentModelId: modelId, sourceRunId: source.id, branchKind: "iterate" });
    await db.insert(jobs).values({ id: nextJobId, kind: "model", targetId: nextId, status: "running", checkpoint: {} });
    await jobContext.run({ id: nextJobId, checkpoint: {} }, () => executeAssetVersionJob(nextId));
    expect(requests).toHaveLength(6);
    expect(Buffer.from(requests[4].images[0])).toEqual(Buffer.concat([png, Buffer.from("fixture-1")]));
    expect(Buffer.from(requests[5].images[0])).toEqual(Buffer.concat([png, Buffer.from("fixture-2")]));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalBase;
    await db.delete(events).where(inArray(events.runId, db.select({ id: runs.id }).from(runs).where(eq(runs.projectId, projectId))));
    await db.delete(jobs).where(inArray(jobs.id, [jobId, nextJobId]));
    await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
    await db.delete(assetEntries).where(eq(assetEntries.projectId, projectId));
    await db.delete(batches).where(eq(batches.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
    for (const id of [modelId, nextId]) await rm(resolve(DATA, "graphics", id), { recursive: true, force: true });
  }
});
