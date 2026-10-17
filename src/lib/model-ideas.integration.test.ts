import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, modelIdeas, models, projects } from "../db/schema";
import { api } from "./api.server";
import { ideaInput } from "./api-inputs";
import { returnModelToIdea, saveModelIdea, startModelIdea, updateModelIdea } from "./model-ideas.server";

// Use an isolated migrated database with no worker.
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const design = "# Collection style\n" + "Simple ivory forms and forest green accents. ".repeat(4);
const input = { prompt: "A small sedan", count: 1, judgeIterations: 2, imageSize: "1024x1024" };
// Saves and edits name their idea: a blank title would call the AI provider, which these tests do not have.
const saves = (suffix: string, method: string) => method !== "DELETE" && /^(\/[^/]+)?$/.test(suffix);
const send = (projectId: string, suffix: string, body?: unknown, method = "POST") => api(new Request(
  `http://localhost/api/projects/${projectId}/ideas${suffix}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(saves(suffix, method) ? { title: "Test idea", ...(body as object) } : body) }),
  },
));
async function cleanup(ids: string[]) {
  const savedBatches = await db.select({ id: batches.id }).from(batches).where(inArray(batches.projectId, ids));
  if (savedBatches.length) await db.delete(jobs).where(inArray(jobs.targetId, savedBatches.map(({ id }) => id)));
  await db.delete(modelIdeas).where(inArray(modelIdeas.projectId, ids));
  await db.delete(models).where(inArray(models.projectId, ids));
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
    const projectIds = (await db.select({ id: projects.id }).from(projects)).map(({ id }) => id).sort();
    for (const count of [0, 21, 1.5]) expect((await send(id, "", { ...input, count })).status).toBe(400);
    for (const prompt of ["", "   "]) expect((await send(id, "", { ...input, prompt })).status).toBe(400);
    const saved = await send(id, "", input);
    expect(saved.status).toBe(201);
    const created = await saved.json();
    const ideaId = created.id;
    expect(created.title).toBe("Test idea");
    const detail = await (await api(new Request(`http://localhost/api/projects/${id}`))).json();
    expect(detail.ideas).toMatchObject([{ id: ideaId, projectId: id, title: "Test idea", input }]);
    expect(detail.ideas[0].input).not.toHaveProperty("title");
    expect((await send(id, `/${ideaId}`, { ...input, prompt: "" }, "PUT")).status).toBe(400);
    expect(detail.batches).toEqual([]);
    expect(await db.select().from(jobs).where(eq(jobs.targetId, ideaId))).toEqual([]);
    expect((await send(other, `/${ideaId}`, input, "PUT")).status).toBe(400);
    expect((await send(id, `/${ideaId}`, { ...input, count: 21 }, "PUT")).status).toBe(400);
    const edited = { ...input, prompt: "A yellow cab", count: 2, judgeIterations: 0,
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
    const [retained] = await db.select().from(modelIdeas).where(eq(modelIdeas.id, ideaId));
    expect(retained.batchId).toBeNull();
    await db.update(projects).set({ status: "ready", design: "Updated " + design, designVersion: 2 }).where(eq(projects.id, id));
    const started = await Promise.all([send(id, `/${ideaId}/generate`, {}), send(id, `/${ideaId}/generate`, {})]);
    expect(started.map((response) => response.status)).toEqual([201, 201]);
    const results = await Promise.all(started.map((response) => response.json()));
    expect(results[0].id).toBe(results[1].id);
    const [batch] = await db.select().from(batches).where(eq(batches.projectId, id));
    expect(batch).toMatchObject({ ...edited, projectId: id, designVersion: 2, design: "Updated " + design });
    expect(await db.select().from(jobs).where(eq(jobs.targetId, batch.id))).toMatchObject([{ kind: "plan", status: "queued" }]);
    expect((await send(id, `/${ideaId}`, input, "PUT")).status).toBe(400);
    expect((await send(id, `/${ideaId}`, undefined, "DELETE")).status).toBe(400);
    expect((await send(id, `/${ideaId}/ready`, { ready: false })).status).toBe(400);
    expect((await (await api(new Request(`http://localhost/api/projects/${id}`))).json()).ideas).toEqual([]);
    await db.update(projects).set({ design: "Later " + design, designVersion: 3 }).where(eq(projects.id, id));
    expect((await db.select().from(batches).where(eq(batches.id, batch.id)))[0].designVersion).toBe(2);
    expect((await db.select({ id: projects.id }).from(projects)).map(({ id }) => id).sort()).toEqual(projectIds);
  } finally { await cleanup([id, other]); }
});

integration("discard removes only an unstarted idea and graphics retain canvas validation", async () => {
  const id = crypto.randomUUID();
  try {
    await db.insert(projects).values({ id, name: "Graphic ideas", assetType: "graphic", description: "test", design, designVersion: 1, status: "ready" });
    expect((await send(id, "", { ...input, spriteTarget: { size: 64 } })).status).toBe(400);
    const ideaInput = { ...input, judgeIterations: 1, imageSize: "1024x1536", count: 2 };
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
    await db.insert(models).values([
      { id: done, projectId: id, batchId, name: "Chair", prompt: "x", status: "done" },
      { id: building, projectId: id, batchId, name: "Table", prompt: "x", status: "building" },
    ]);
    const otherBatch = crypto.randomUUID();
    await db.insert(batches).values({ id: otherBatch, projectId: other, prompt: "x", count: 1, judgeIterations: 0, design, designVersion: 1, status: "done" });
    await db.insert(models).values({ id: foreign, projectId: other, batchId: otherBatch, name: "Lamp", prompt: "x", status: "done" });
    expect((await post(`models/${building}/accept`, { accepted: true })).status).toBe(400);
    expect((await post(`projects/${id}/export`, { acceptedOnly: true })).status).toBe(400);
    expect((await post(`models/${done}/accept`, { accepted: true })).status).toBe(200);
    expect((await post(`projects/${id}/export`, { modelIds: [foreign] })).status).toBe(400);
    const exported = await post(`projects/${id}/export`, { acceptedOnly: true });
    expect(exported.status).toBe(201);
    expect(await exported.json()).toMatchObject({ assets: 1, files: 0 });
    expect((await post(`models/${done}/accept`, { accepted: false })).status).toBe(200);
    expect((await db.select().from(models).where(eq(models.id, done)))[0].acceptedAt).toBeNull();
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
    const generated = await saveModelIdea(project, ideaInput.parse(body), writer);
    expect(generated.title).toBe("Titled: A small sedan");
    expect(calls).toEqual(["A small sedan"]);
    const named = await saveModelIdea(project, ideaInput.parse({ ...body, title: "  My title " }), writer);
    expect(named.title).toBe("My title");
    expect(calls).toHaveLength(1);
    await expect(saveModelIdea(project, ideaInput.parse(body), failing)).rejects.toThrow("Provider unavailable");
    expect(await db.select().from(modelIdeas).where(eq(modelIdeas.projectId, id))).toHaveLength(2);
    // An edit that clears the title rewrites it from the new brief; a kept title costs no call.
    await updateModelIdea(project, generated.id, ideaInput.parse({ ...body, prompt: "A red pickup" }), writer);
    expect((await db.select().from(modelIdeas).where(eq(modelIdeas.id, generated.id)))[0].title).toBe("Titled: A red pickup");
    await updateModelIdea(project, generated.id, ideaInput.parse({ ...body, title: "Kept" }), writer);
    expect(calls).toEqual(["A small sedan", "A red pickup"]);
    // A started idea cannot be edited and must not cost an AI call.
    await startModelIdea(id, generated.id);
    await expect(updateModelIdea(project, generated.id, ideaInput.parse(body), writer)).rejects.toThrow("no longer available");
    expect(calls).toHaveLength(2);
  } finally { await cleanup([id]); }
});

integration("a generated asset returns to the idea it was started from, optionally deleting it atomically", async () => {
  const id = crypto.randomUUID();
  const [root, iteration, running, direct] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const post = (path: string, body?: unknown) => api(new Request(`http://localhost/api/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const ideas = async () => (await db.select().from(modelIdeas).where(eq(modelIdeas.projectId, id))).filter((idea) => !idea.batchId);
  const setReady = (ideaId: string) => db.update(modelIdeas).set({ readyAt: new Date() }).where(eq(modelIdeas.id, ideaId));
  try {
    await db.insert(projects).values({ id, name: "Return fixture", description: "test", design, designVersion: 1, status: "ready" });
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    const sprite = { size: 64, directions: 8, frameCount: 2, pixel: true, loop: true };
    const original = await saveModelIdea(project, ideaInput.parse({ ...input, title: "Oak chair", count: 3, spriteTarget: sprite }), async () => "unused");
    await setReady(original.id);
    const batchId = await startModelIdea(id, original.id);
    await db.insert(models).values([
      { id: root, projectId: id, batchId, name: "Oak_Chair", prompt: "planner prompt for the chair", status: "done" },
      { id: running, projectId: id, batchId, name: "Oak_Table", prompt: "planner prompt for the table", status: "building" },
    ]);
    const iterationBatch = crypto.randomUUID();
    await db.insert(batches).values({ id: iterationBatch, projectId: id, prompt: "x", count: 1, judgeIterations: 0, design, designVersion: 1, status: "done" });
    await db.insert(models).values({ id: iteration, projectId: id, batchId: iterationBatch, name: "Oak_Chair", prompt: "x", status: "done", parentModelId: root, branchKind: "iterate" });

    // An iteration returns the idea its entry was started from, not its own throwaway batch.
    const copy = await returnModelToIdea(iteration, false);
    expect(copy).toMatchObject({ title: "Oak chair", deleted: false });
    const [created] = (await ideas()).filter((idea) => idea.id === copy.id);
    expect(created).toMatchObject({ title: "Oak chair", input: { prompt: "A small sedan", count: 3, spriteTarget: sprite } });
    expect(created.readyAt).not.toBeNull();
    expect(created.batchId).toBeNull();
    expect((await db.select().from(models).where(eq(models.projectId, id)))).toHaveLength(3);
    expect((await db.select().from(modelIdeas).where(eq(modelIdeas.id, original.id)))[0].batchId).toBe(batchId);

    // Over the API; an unknown asset is rejected and nothing is created.
    expect((await post(`models/${crypto.randomUUID()}/idea`, {})).status).toBe(400);
    const api201 = await post(`models/${iteration}/idea`);
    expect(api201.status).toBe(201);
    expect(await api201.json()).toMatchObject({ title: "Oak chair", deleted: false });
    expect(await ideas()).toHaveLength(2);

    // A still-generating asset cannot be deleted, and the failed attempt must not leave an idea behind.
    const before = (await ideas()).length;
    await expect(returnModelToIdea(running, true)).rejects.toThrow("still being generated");
    expect(await ideas()).toHaveLength(before);
    expect((await returnModelToIdea(running, false)).deleted).toBe(false);

    // Returning the root with deletion removes its iterations too, in one step.
    const removed = await returnModelToIdea(root, true);
    expect(removed.deleted).toBe(true);
    expect((await db.select().from(models).where(eq(models.projectId, id))).map((m) => m.id)).toEqual([running]);
    expect((await ideas()).some((idea) => idea.id === removed.id)).toBe(true);

    // Assets that never came from an idea get one built from the asset; legacy ideas fall back the same way.
    const directBatch = crypto.randomUUID();
    await db.insert(batches).values({ id: directBatch, projectId: id, prompt: "five props", count: 5, judgeIterations: 1, design, designVersion: 1, status: "done", visualTargetMode: "auto" });
    await db.insert(models).values({ id: direct, projectId: id, batchId: directBatch, name: "Mossy_Lantern", prompt: "A mossy iron lantern with a cracked glass pane", status: "done" });
    const built = await returnModelToIdea(direct, false);
    expect(built.title).toBe("Mossy Lantern");
    expect((await ideas()).find((idea) => idea.id === built.id)).toMatchObject({
      readyAt: null,
      input: { prompt: "A mossy iron lantern with a cracked glass pane", count: 1, judgeIterations: 1, visualTargetMode: "review", imageSize: "1024x1024" },
    });
    await db.update(modelIdeas).set({ batchId: directBatch, title: null, input: { ...input, imageSize: "1024x1024" as const, prompt: "" } }).where(eq(modelIdeas.id, built.id));
    const legacy = await returnModelToIdea(direct, false);
    expect(legacy.title).toBe("Mossy Lantern");
    expect((await ideas()).find((idea) => idea.id === legacy.id)?.input.prompt).toBe("A mossy iron lantern with a cracked glass pane");

    // An archived project is read-only.
    await db.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, id));
    await expect(returnModelToIdea(direct, false)).rejects.toThrow();
  } finally { await cleanup([id]); }
});
