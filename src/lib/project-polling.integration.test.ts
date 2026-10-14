import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { events, projects, runs } from "../db/schema";
import { api } from "./api.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration("workspace summaries omit transcript bodies while run details and the full API retain them", async () => {
  const projectId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  await db.insert(projects).values({ id: projectId, name: "Polling fixture", description: "test" });
  try {
    await db.insert(runs).values({
      id: runId, projectId, role: "designer", model: "fixture", status: "done",
      promptVersion: "test", systemPrompt: "Saved role instructions", input: "Saved input",
      output: "Saved output", images: ["references/fixture.png"], result: { design: "Saved design" },
      inputTokens: 100, outputTokens: 20, estimatedCost: 0.012,
      rates: { input: 1, cached: 0, output: 1, source: "test" },
    });
    await db.insert(events).values({ id: crypto.randomUUID(), runId, type: "output", payload: { text: "Saved event" } });
    const get = async (path: string) => {
      const response = await api(new Request(`http://localhost/api/${path}`));
      expect(response.status).toBe(200);
      return response.json();
    };
    const full = await get(`projects/${projectId}`);
    const summary = await get(`projects/${projectId}?summary=true`);
    const { systemPrompt, input, output, images, ...runSummary } = full.runs[0];
    expect(summary).toEqual({ ...full, runs: [runSummary] });
    expect(summary.runs[0]).toMatchObject({ id: runId, inputTokens: 100, outputTokens: 20, estimatedCost: 0.012 });
    for (const key of ["systemPrompt", "input", "output", "images"]) expect(summary.runs[0]).not.toHaveProperty(key);
    const detail = await get(`runs/${runId}/details`);
    expect(detail.run).toEqual(full.runs[0]);
    expect(detail.run).toMatchObject({ systemPrompt: "Saved role instructions", input: "Saved input", output: "Saved output", images: ["references/fixture.png"] });
    expect(detail.events).toEqual(await get(`runs/${runId}`));
    expect(await get(`runs/${runId}/details?events=false`)).toEqual({ run: detail.run, events: [] });
    expect(detail.events[0].payload).toEqual({ text: "Saved event" });
    expect((await api(new Request(`http://localhost/api/runs/${crypto.randomUUID()}/details`))).status).toBe(404);
    const modelId = crypto.randomUUID();
    const analysis = { version: 1, findings: [], unavailable: ["fixture"], sha256: "saved-hash" };
    await db.insert(runs).values([{
      id: crypto.randomUUID(), projectId, modelId, role: "builder", model: "fixture", status: "done",
      promptVersion: "test", systemPrompt: "Builder instructions", input: "Builder input",
      result: { artifacts: { glb: "versions/fixture/asset.glb" }, summary: "Saved build" },
      createdAt: new Date("2026-01-01T00:00:00Z"),
      rates: { input: 0, cached: 0, output: 0, source: "test" },
    }, {
      id: crypto.randomUUID(), projectId, modelId, role: "judge", model: "fixture", status: "done",
      promptVersion: "test", systemPrompt: "Judge instructions",
      input: "Review\nDETERMINISTIC ANALYSIS (read-only, advisory)\n" + JSON.stringify(analysis),
      result: { passed: true, score: 90 }, createdAt: new Date("2026-01-01T00:01:00Z"),
      rates: { input: 0, cached: 0, output: 0, source: "test" },
    }]);
    const reviewed = await get(`projects/${projectId}?summary=true`);
    expect(reviewed.versions).toEqual((await get(`projects/${projectId}`)).versions);
    expect(reviewed.versions[0]).toMatchObject({
      artifacts: { glb: "versions/fixture/asset.glb" }, summary: "Saved build",
      judges: [{ result: { passed: true, score: 90 }, analysis }],
    });
  } finally {
    await db.delete(events).where(eq(events.runId, runId));
    await db.delete(runs).where(eq(runs.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
});
