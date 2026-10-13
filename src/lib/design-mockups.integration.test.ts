import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { events, jobs, projects, runs } from "../db/schema";
import { api } from "./api.server";
import { jobContext } from "./checkpoint.server";
import { mockupSnapshot } from "./design-mockups";
import { executeJob, failJob } from "./pipeline.server";
import { cancelJob } from "./queue.server";
import { DATA } from "./storage.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const design = "# Approved mockup style\n" + "Ivory stone and forest green, simple matte forms. ".repeat(4);

integration("mockups require approval, freeze inputs, deduplicate requests, and keep generation optional", async () => {
  const id = crypto.randomUUID();
  const references = ["references/mockup-fixture.png"];
  const send = (body: unknown) => api(new Request(`http://localhost/api/projects/${id}/mockups`, {
    method: "POST", body: JSON.stringify(body),
  }));
  try {
    await db.insert(projects).values({ id, name: "Mockup fixture", description: "test", design,
      designVersion: 2, references, status: "review" });
    expect((await send({ version: 2 })).status).toBe(400);
    await db.update(projects).set({ status: "ready" }).where(eq(projects.id, id));
    expect((await send({ version: 1 })).status).toBe(400);
    for (const count of [0, 5, 1.5]) expect((await send({ version: 2, count })).status).toBe(400);
    const responses = await Promise.all([send({ version: 2, count: 2 }), send({ version: 2, count: 2 })]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const results = await Promise.all(responses.map((response) => response.json()));
    expect(results[0].id).toBe(results[1].id);
    const [job] = await db.select().from(jobs).where(eq(jobs.targetId, id));
    const input = mockupSnapshot.parse(JSON.parse(job.checkpoint.input));
    expect(input.version).toBe(2);
    expect(input.references).toEqual(references);
    expect(input.prompts).toHaveLength(2);
    expect(input.prompts[0]).toContain(design);
    expect(input.prompts[0]).toContain("concept 1 of 2");
    expect(input.prompts[1]).toContain("concept 2 of 2");
    await db.update(projects).set({ design: "Updated " + design, designVersion: 3, references: [] })
      .where(eq(projects.id, id));
    const [frozen] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(frozen.checkpoint).toEqual(job.checkpoint);
    const detail = await (await api(new Request(`http://localhost/api/projects/${id}`))).json();
    expect(detail.mockups[0]).toMatchObject({ id: job.id, version: 2, count: 2, status: "queued", images: [] });
    const queue = await (await api(new Request("http://localhost/api/queue"))).json();
    expect(queue.jobs.find((entry: { id: string }) => entry.id === job.id)).toMatchObject({
      kind: "design-mockups", projectId: id, name: "Design mockups",
    });
    await failJob("design-mockups", id, "Provider error");
    expect((await db.select().from(projects).where(eq(projects.id, id)))[0].status).toBe("ready");
    expect(await cancelJob(job.id, true)).toBe("cancelled");
    expect((await db.select().from(projects).where(eq(projects.id, id)))[0].status).toBe("ready");
  } finally {
    await db.delete(jobs).where(eq(jobs.targetId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});

integration("partial mockups reuse completed runs, generate remaining images once, and retain their snapshot", async () => {
  const projectId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const directory = `mockups/${projectId}/${jobId}`;
  const input = { version: 2, references: [], prompts: ["Saved concept one", "Saved concept two"] };
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFcAAAAASUVORK5CYII=", "base64");
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalBase = process.env.OPENAI_BASE_URL;
  let providerRequests = 0;
  try {
    process.env.OPENAI_API_KEY = "mockup-test-fixture";
    process.env.OPENAI_BASE_URL = "https://mockups.invalid/v1";
    await db.insert(projects).values({ id: projectId, name: "Recovered mockups", description: "test", design,
      designVersion: 3, status: "ready" });
    await db.insert(jobs).values({ id: jobId, kind: "design-mockups", targetId: projectId, status: "failed",
      checkpoint: { input: JSON.stringify(input) }, error: "Interrupted" });
    await mkdir(resolve(DATA, directory), { recursive: true });
    for (const [index, text] of input.prompts.slice(0, 1).entries()) {
      const runId = crypto.randomUUID();
      const digest = createHash("sha256").update(JSON.stringify([text, [], "1536x1024"])).digest("hex").slice(0, 16);
      const identity = `mockup-${index + 1}-${digest}.png`;
      const key = `${directory}/saved-${index}.png`;
      await writeFile(resolve(DATA, key), png);
      await db.insert(runs).values({
        id: runId, projectId, role: "design-mockup", engine: "imagegen", status: "done", model: "fixture",
        promptVersion: "fixture", systemPrompt: "fixture", input: text,
        stepId: `mockup:${index}:${directory}/${identity}`,
        result: { key, path: resolve(DATA, key), runId, name: `mockup-${index + 1}` },
        rates: { input: 2, cached: 0.2, output: 10, source: "fixture" },
      });
    }
    const resume = () => api(new Request(`http://localhost/api/queue/${jobId}/resume`, { method: "POST" }));
    expect((await resume()).status).toBe(200);
    expect((await resume()).status).toBe(400);
    globalThis.fetch = Object.assign(async (_url: string | URL | Request, init?: RequestInit) => {
      providerRequests++;
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "gpt-image-2", quality: "medium", prompt: "Saved concept two", size: "1536x1024", n: 1,
      });
      return Response.json({ data: [{ b64_json: png.toString("base64") }], usage: { input_tokens: 12, output_tokens: 24 } });
    }, { preconnect: originalFetch.preconnect });
    for (let replay = 0; replay < 2; replay++) {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
      await jobContext.run({ id: job.id, checkpoint: job.checkpoint }, () => executeJob("design-mockups", projectId));
    }
    const [saved] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(saved.checkpoint.applied).toBe("yes");
    expect(saved.checkpoint.input).toBe(JSON.stringify(input));
    expect(providerRequests).toBe(1);
    expect(await db.select().from(runs).where(eq(runs.projectId, projectId))).toHaveLength(2);
    const detail = await (await api(new Request(`http://localhost/api/projects/${projectId}`))).json();
    expect(detail.mockups[0].version).toBe(2);
    expect(detail.mockups[0].images).toHaveLength(2);
    expect(detail.mockups[0].images[0].key).toBe(`${directory}/saved-0.png`);
    expect(detail.mockups[0].images[1].key).toStartWith(`${directory}/mockup-2-`);
    const generated = detail.runs.find((run: { input: string }) => run.input === "Saved concept two");
    expect(generated.inputTokens).toBe(12);
    expect(generated.outputTokens).toBe(24);
    expect(generated.estimatedCost).toBeGreaterThan(0);
    expect(detail.project.designVersion).toBe(3);
    expect(detail.project.status).toBe("ready");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalBase;
    await db.delete(events).where(inArray(events.runId,
      db.select({ id: runs.id }).from(runs).where(eq(runs.projectId, projectId)),
    ));
    await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await rm(resolve(DATA, "mockups", projectId), { recursive: true, force: true });
  }
});
