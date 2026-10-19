import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, assetEntries, assetVersions, projects } from "../db/schema";
import { api } from "./api.server";
import { ideaInput } from "./api-inputs";
import { reopenVersionAsIdea, createAsset, startAsset, updateAsset } from "./assets.server";

// Use an isolated migrated database with no worker.
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const design = "# Collection style\n" + "Simple ivory forms and forest green accents. ".repeat(4);
const input = { prompt: "A small sedan", count: 1, judgeIterations: 2, imageSize: "1024x1024" };
// Saves and edits name their idea: a blank title would call the AI provider, which these tests do not have.
const saves = (suffix: string, method: string) => method !== "DELETE" && /^(\/[^/]+)?$/.test(suffix);
const send = (projectId: string, suffix: string, body?: unknown, method = "POST") => api(new Request(
  `http://localhost/api/projects/${projectId}/assets${suffix}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(saves(suffix, method) ? { title: "Test idea", ...(body as object) } : body) }),
  },
));
async function cleanup(ids: string[]) {
  const savedVersions = await db.select({ id: assetVersions.id }).from(assetVersions).where(inArray(assetVersions.projectId, ids));
  if (savedVersions.length) await db.delete(jobs).where(inArray(jobs.targetId, savedVersions.map(({ id }) => id)));
  const savedBatches = await db.select({ id: batches.id }).from(batches).where(inArray(batches.projectId, ids));
  if (savedBatches.length) await db.delete(jobs).where(inArray(jobs.targetId, savedBatches.map(({ id }) => id)));
  await db.delete(assetEntries).where(inArray(assetEntries.projectId, ids));
  await db.delete(assetVersions).where(inArray(assetVersions.projectId, ids));
  await db.delete(batches).where(inArray(batches.projectId, ids));
  await db.delete(projects).where(inArray(projects.id, ids));
}

integration("ideas persist without jobs, require approval to start, and queue once in their own project", async () => {
  const id = crypto.randomUUID();
  const other = crypto.randomUUID();
  try {
    await db.insert(projects).values([
      { id, name: "Ideas fixture", description: "test", design, designVersion: 1, status: "review" },
      { id: other, name: "Other fixture", description: "test", design, designVersion: 1, status: "ready" },
    ]);
    const projectIds = [id, other].sort();
    for (const count of [0, 2, 21, 1.5]) expect((await send(id, "", { ...input, count })).status).toBe(400);
    const saved = await send(id, "", input);
    expect(saved.status).toBe(201);
    const created = await saved.json();
    const ideaId = created.id;
    expect(created.title).toBe("Test idea");
    const detail = await (await api(new Request(`http://localhost/api/projects/${id}`))).json();
    expect(detail.ideas).toMatchObject([{ id: ideaId, projectId: id, title: "Test idea", input }]);
    expect(detail.ideas[0].input).not.toHaveProperty("title");
    expect(detail.batches).toEqual([]);
    expect(await db.select().from(jobs).where(eq(jobs.targetId, ideaId))).toEqual([]);
    expect((await send(other, `/${ideaId}`, input, "PUT")).status).toBe(400);
    expect((await send(id, `/${ideaId}`, { ...input, count: 21 }, "PUT")).status).toBe(400);
    const edited = { ...input, prompt: "A yellow cab", count: 1, judgeIterations: 0,
      spriteTarget: { size: 128, directions: 4, frameCount: 3, pixel: false, loop: false } };
    expect((await send(id, `/${ideaId}`, edited, "PUT")).status).toBe(200);
    const afterEdit = await (await api(new Request(`http://localhost/api/projects/${id}`))).json();
    expect(afterEdit.ideas).toMatchObject([{ id: ideaId, title: "Test idea", input: edited }]);
    expect((await send(id, `/${ideaId}`, { ...edited, title: "  Yellow cab  " }, "PUT")).status).toBe(200);
    expect((await (await api(new Request(`http://localhost/api/projects/${id}`))).json()).ideas[0].title).toBe("Yellow cab");
    expect(afterEdit.batches).toEqual([]);
    expect((await send(id, `/${ideaId}/ready`, { ready: true })).status).toBe(200);
    expect((await send(other, `/${ideaId}/ready`, { ready: false })).status).toBe(400);
    const marked = await (await api(new Request(`http://localhost/api/projects/${id}`))).json();
    expect(marked.ideas[0].readyAt).toBeString();
    expect(marked.batches).toEqual([]);
    expect((await send(other, `/${ideaId}`, undefined, "DELETE")).status).toBe(400);
    expect((await send(other, `/${ideaId}/generate`, {})).status).toBe(400);
    expect((await send(id, `/${ideaId}/generate`, {})).status).toBe(400);
    const [retained] = await db.select().from(assetEntries).where(eq(assetEntries.id, ideaId));
    expect(retained.batchId).toBeNull();
    await db.update(projects).set({ status: "ready", design: "Updated " + design, designVersion: 2 }).where(eq(projects.id, id));
    const started = await Promise.all([send(id, `/${ideaId}/generate`, {}), send(id, `/${ideaId}/generate`, {})]);
    expect(started.map((response) => response.status)).toEqual([201, 201]);
    const results = await Promise.all(started.map((response) => response.json()));
    expect(results[0].id).toBe(results[1].id);
    const [batch] = await db.select().from(batches).where(eq(batches.projectId, id));
    expect(batch).toMatchObject({ ...edited, projectId: id, designVersion: 2, design: "Updated " + design });
    expect(await db.select().from(jobs).where(eq(jobs.targetId, batch.id))).toMatchObject([{ kind: "plan", status: "queued" }]);
    expect((await send(id, `/${ideaId}`, input, "PUT")).status).toBe(200);
    expect((await db.select().from(assetEntries).where(eq(assetEntries.id, ideaId)))[0].input).toMatchObject(input);
    expect((await db.select().from(batches).where(eq(batches.id, batch.id)))[0].prompt).toBe(edited.prompt);
    expect((await send(id, `/${ideaId}`, undefined, "DELETE")).status).toBe(400);
    expect((await send(id, `/${ideaId}/ready`, { ready: false })).status).toBe(400);
    expect((await (await api(new Request(`http://localhost/api/projects/${id}`))).json()).ideas).toEqual([]);
    await db.update(projects).set({ design: "Later " + design, designVersion: 3 }).where(eq(projects.id, id));
    expect((await db.select().from(batches).where(eq(batches.id, batch.id)))[0].designVersion).toBe(2);
    expect((await db.select({ id: projects.id }).from(projects).where(inArray(projects.id, projectIds))).map(({ id }) => id).sort()).toEqual(projectIds);
  } finally { await cleanup([id, other]); }
});

integration("discard removes only an unstarted idea and graphics retain canvas validation", async () => {
  const id = crypto.randomUUID();
  try {
    await db.insert(projects).values({ id, name: "Graphic ideas", assetType: "graphic", description: "test", design, designVersion: 1, status: "ready" });
    expect((await send(id, "", { ...input, spriteTarget: { size: 64 } })).status).toBe(400);
    const ideaInput = { ...input, judgeIterations: 1, imageSize: "1024x1536", count: 1 };
    const ideaId = (await (await send(id, "", ideaInput)).json()).id;
    expect((await send(id, `/${ideaId}`, { ...ideaInput, imageSize: "1536x1024", prompt: "Wide poster" }, "PUT")).status).toBe(200);
    expect((await (await api(new Request(`http://localhost/api/projects/${id}`))).json()).ideas[0].input).toMatchObject({ imageSize: "1536x1024", prompt: "Wide poster" });
    expect((await send(id, `/${ideaId}`, undefined, "DELETE")).status).toBe(200);
    expect((await send(id, `/${ideaId}/generate`, {})).status).toBe(400);
    expect(await db.select().from(batches).where(eq(batches.projectId, id))).toEqual([]);
    const keptId = (await (await send(id, "", ideaInput)).json()).id;
    expect((await send(id, `/${keptId}/generate`, {})).status).toBe(201);
    expect((await db.select().from(batches).where(eq(batches.projectId, id)))[0]).toMatchObject(ideaInput);
  } finally { await cleanup([id]); }
});

integration("accept marks only finished assets and export zips accepted entries of this project", async () => {
  const id = crypto.randomUUID();
  const other = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const [done, building, foreign] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const post = (path: string, body: unknown) => api(new Request(`http://localhost/api/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  try {
    await db.insert(projects).values([
      { id, name: "Accept fixture", description: "test", design, designVersion: 1, status: "ready" },
      { id: other, name: "Other fixture", description: "test", design, designVersion: 1, status: "ready" },
    ]);
    await db.insert(batches).values({ id: batchId, projectId: id, prompt: "x", count: 2, judgeIterations: 0, design, designVersion: 1, status: "done" });
    await db.insert(assetVersions).values([
      { id: done, projectId: id, batchId, name: "Chair", prompt: "x", status: "done" },
      { id: building, projectId: id, batchId, name: "Table", prompt: "x", status: "building" },
    ]);
    const otherBatch = crypto.randomUUID();
    await db.insert(batches).values({ id: otherBatch, projectId: other, prompt: "x", count: 1, judgeIterations: 0, design, designVersion: 1, status: "done" });
    await db.insert(assetVersions).values({ id: foreign, projectId: other, batchId: otherBatch, name: "Lamp", prompt: "x", status: "done" });
    expect((await post(`models/${building}/accept`, { accepted: true })).status).toBe(400);
    expect((await post(`projects/${id}/export`, { acceptedOnly: true })).status).toBe(400);
    expect((await post(`models/${done}/accept`, { accepted: true })).status).toBe(200);
    expect((await post(`projects/${id}/export`, { modelIds: [foreign] })).status).toBe(400);
    const exported = await post(`projects/${id}/export`, { acceptedOnly: true });
    expect(exported.status).toBe(201);
    expect(await exported.json()).toMatchObject({ assets: 1, files: 0 });
    expect((await post(`models/${done}/accept`, { accepted: false })).status).toBe(200);
    expect((await db.select().from(assetVersions).where(eq(assetVersions.id, done)))[0].acceptedAt).toBeNull();
  } finally { await cleanup([id, other]); }
});

integration("a blank title is written from the brief, and an AI failure stores nothing", async () => {
  const id = crypto.randomUUID();
  const calls: string[] = [];
  const writer = async (_: string, brief: string) => { calls.push(brief); return `Titled: ${brief}`; };
  const failing = async () => { throw new Error("Provider unavailable"); };
  try {
    await db.insert(projects).values({ id, name: "Title fixture", description: "test", design, designVersion: 1, status: "ready" });
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    const body = { ...input, title: "" };
    const generated = await createAsset(project, ideaInput.parse(body), writer);
    expect(generated.title).toBe("Titled: A small sedan");
    expect(calls).toEqual(["A small sedan"]);
    const named = await createAsset(project, ideaInput.parse({ ...body, title: "  My title " }), writer);
    expect(named.title).toBe("My title");
    expect(calls).toHaveLength(1);
    // No brief and no title costs no call; the planner names it later.
    expect((await createAsset(project, ideaInput.parse({ ...body, prompt: "" }), writer)).title).toBeNull();
    expect(calls).toHaveLength(1);
    await expect(createAsset(project, ideaInput.parse(body), failing)).rejects.toThrow("Provider unavailable");
    expect(await db.select().from(assetEntries).where(eq(assetEntries.projectId, id))).toHaveLength(3);
    // An edit that clears the title rewrites it from the new brief; a kept title costs no call.
    await updateAsset(project, generated.id, ideaInput.parse({ ...body, prompt: "A red pickup" }), writer);
    expect((await db.select().from(assetEntries).where(eq(assetEntries.id, generated.id)))[0].title).toBe("Titled: A red pickup");
    await updateAsset(project, generated.id, ideaInput.parse({ ...body, title: "Kept" }), writer);
    expect(calls).toEqual(["A small sedan", "A red pickup"]);
    // Asset edits after starting affect future versions, while the saved batch stays frozen.
    const batchId = await startAsset(id, generated.id);
    const [before] = await db.select().from(batches).where(eq(batches.id, batchId));
    await updateAsset(project, generated.id, ideaInput.parse({ ...body, prompt: "A blue truck" }), writer);
    expect(calls).toEqual(["A small sedan", "A red pickup", "A blue truck"]);
    expect((await db.select().from(batches).where(eq(batches.id, batchId)))[0]).toEqual(before);
  } finally { await cleanup([id]); }
});

integration("returning an asset keeps its identity and versions, ignores legacy deletion, and protects history from discard", async () => {
  const id = crypto.randomUUID();
  const iteration = crypto.randomUUID();
  const running = crypto.randomUUID();
  const post = (path: string, body?: unknown) => api(new Request(`http://localhost/api/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  try {
    await db.insert(projects).values({ id, name: "Return fixture", description: "test", design, designVersion: 1, status: "ready" });
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    const sprite = { size: 64, directions: 8, frameCount: 2, pixel: true, loop: true };
    const original = await createAsset(project, ideaInput.parse({ ...input, title: "Oak chair", spriteTarget: sprite }), async () => "unused");
    await db.update(assetEntries).set({ readyAt: new Date() }).where(eq(assetEntries.id, original.id));
    const batchId = await startAsset(id, original.id);
    const [root] = await db.select().from(assetVersions).where(eq(assetVersions.assetId, original.id));
    await db.update(assetVersions).set({ status: "done", name: "Oak_Chair" }).where(eq(assetVersions.id, root.id));
    const iterationBatch = crypto.randomUUID();
    await db.insert(batches).values({ id: iterationBatch, projectId: id, prompt: "repair", count: 1, judgeIterations: 0, design, designVersion: 1, status: "done" });
    await db.insert(assetVersions).values({ id: iteration, assetId: original.id, projectId: id, batchId: iterationBatch, name: "Oak_Chair", prompt: "repair", status: "done", parentModelId: root.id, branchKind: "iterate" });
    const before = await db.select().from(assetVersions).where(eq(assetVersions.assetId, original.id));
    const [originalBefore] = await db.select().from(assetEntries).where(eq(assetEntries.id, original.id));
    const returned = await reopenVersionAsIdea(iteration);
    expect(returned).toEqual({ id: expect.any(String), title: "Oak chair" });
    expect(returned.id).not.toBe(original.id);
    const [reopened] = await db.select().from(assetEntries).where(eq(assetEntries.id, returned.id));
    expect(reopened).toMatchObject({ inIdea: true, readyAt: null, batchId: null, title: "Oak chair", input: { prompt: "A small sedan", count: 1, spriteTarget: sprite } });
    expect(await db.select().from(assetVersions).where(eq(assetVersions.assetId, returned.id))).toHaveLength(0);
    // The original asset and its versions are left exactly as they were.
    expect((await db.select().from(assetEntries).where(eq(assetEntries.id, original.id)))[0]).toEqual(originalBefore);
    expect(await db.select().from(assetVersions).where(eq(assetVersions.assetId, original.id))).toEqual(before);
    expect((await post(`models/${crypto.randomUUID()}/idea`, {})).status).toBe(400);
    expect(await (await post(`models/${iteration}/idea`)).json()).toEqual({ id: expect.any(String), title: "Oak chair" });
    expect(await db.select().from(assetEntries).where(eq(assetEntries.projectId, id))).toHaveLength(3);
    expect((await send(id, `/${original.id}`, undefined, "DELETE")).status).toBe(400);
    expect(await db.select().from(assetVersions).where(eq(assetVersions.assetId, original.id))).toEqual(before);

    const secondBatch = await startAsset(id, returned.id);
    expect(secondBatch).not.toBe(batchId);
    expect(await startAsset(id, returned.id)).toBe(secondBatch);
    expect(await db.select().from(assetVersions).where(eq(assetVersions.assetId, returned.id))).toHaveLength(1);
    expect(await db.select().from(assetVersions).where(eq(assetVersions.assetId, original.id))).toEqual(before);

    // Direct version inserts acquire their own stable asset through the ownership trigger.
    // Reopening is allowed while that version is still generating and does not touch it.
    await db.insert(assetVersions).values({ id: running, projectId: id, batchId: iterationBatch, name: "Oak_Table", prompt: "A table", status: "building" });
    const whileRunning = await reopenVersionAsIdea(running);
    expect(whileRunning).toEqual({ id: expect.any(String), title: "Oak Table" });
    expect((await db.select().from(assetVersions).where(eq(assetVersions.id, running)))[0].status).toBe("building");
    expect((await db.select().from(assetEntries).where(eq(assetEntries.id, whileRunning.id)))[0]).toMatchObject({ inIdea: true, batchId: null });
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, id));
    await expect(reopenVersionAsIdea(iteration)).rejects.toThrow();
  } finally { await cleanup([id]); }
});
