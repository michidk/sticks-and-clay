import { expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, modelIdeas, projects } from "../db/schema";
import { api } from "./api.server";

// Use an isolated migrated database with no worker.
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const design = "# Collection style\n" + "Simple ivory forms and forest green accents. ".repeat(4);
const input = { prompt: "A small sedan", count: 1, judgeIterations: 2, imageSize: "1024x1024" };
const send = (projectId: string, suffix: string, body?: unknown, method = "POST") => api(new Request(
  `http://localhost/api/projects/${projectId}/ideas${suffix}`, {
    method, headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  },
));
async function cleanup(ids: string[]) {
  const savedBatches = await db.select({ id: batches.id }).from(batches).where(inArray(batches.projectId, ids));
  if (savedBatches.length) await db.delete(jobs).where(inArray(jobs.targetId, savedBatches.map(({ id }) => id)));
  await db.delete(modelIdeas).where(inArray(modelIdeas.projectId, ids));
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
    const saved = await send(id, "", input);
    expect(saved.status).toBe(201);
    const ideaId = (await saved.json()).id;
    const detail = await (await api(new Request(`http://localhost/api/projects/${id}`))).json();
    expect(detail.ideas).toMatchObject([{ id: ideaId, projectId: id, input }]);
    expect(detail.batches).toEqual([]);
    expect(await db.select().from(jobs).where(eq(jobs.targetId, ideaId))).toEqual([]);
    expect((await send(other, `/${ideaId}`, input, "PUT")).status).toBe(400);
    expect((await send(id, `/${ideaId}`, { ...input, count: 21 }, "PUT")).status).toBe(400);
    const edited = { ...input, prompt: "A yellow cab", count: 2, judgeIterations: 0,
      spriteTarget: { size: 128, directions: 4, frameCount: 3, pixel: false, loop: false } };
    expect((await send(id, `/${ideaId}`, edited, "PUT")).status).toBe(200);
    const afterEdit = await (await api(new Request(`http://localhost/api/projects/${id}`))).json();
    expect(afterEdit.ideas).toMatchObject([{ id: ideaId, input: edited }]);
    expect(afterEdit.batches).toEqual([]);
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
    expect((await send(id, "", input)).status).toBe(400);
    expect((await send(id, "", { ...input, judgeIterations: 0, spriteTarget: { size: 64 } })).status).toBe(400);
    const ideaInput = { ...input, judgeIterations: 0, imageSize: "1024x1536", count: 2 };
    const ideaId = (await (await send(id, "", ideaInput)).json()).id;
    expect((await send(id, `/${ideaId}`, input, "PUT")).status).toBe(400);
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
