import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { batches, jobs, models, projects, revisions, runs } from "../db/schema";
import { api } from "./api.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const call = (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") =>
  api(new Request(`http://localhost/api/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));

async function createProject(name: string, description: string) {
  const form = new FormData();
  form.set("name", name);
  form.set("description", description);
  form.set("assetType", "graphic");
  const response = await api(new Request("http://localhost/api/projects", { method: "POST", body: form }));
  expect(response.status).toBe(201);
  return (await response.json()).id as string;
}
async function remove(id: string) {
  await db.delete(runs).where(eq(runs.projectId, id));
  await db.delete(revisions).where(eq(revisions.projectId, id));
  await db.delete(jobs).where(eq(jobs.targetId, id));
  await db.delete(projects).where(eq(projects.id, id));
}

integration("a new project's brief becomes design v1 verbatim, with no AI job", async () => {
  const brief = "Flat coffee icons, thin outlines, warm palette.";
  const id = await createProject("Brief fixture", brief);
  const blank = await createProject("Blank fixture", "");
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    expect(project).toMatchObject({ design: brief, designVersion: 1, status: "review" });
    const [first] = await db.select().from(revisions).where(eq(revisions.projectId, id));
    expect(first).toMatchObject({ version: 1, content: brief, author: "user", approved: false });
    expect(await db.select().from(jobs).where(eq(jobs.targetId, id))).toHaveLength(0);
    expect((await db.select().from(projects).where(eq(projects.id, blank)))[0].design).toBe("# Blank fixture");
  } finally {
    await remove(id);
    await remove(blank);
  }
});

integration("approve, AI draft revert and archive keep revisions, approval and generation rules", async () => {
  const id = await createProject("Lifecycle fixture", "Original brief for the lifecycle fixture.");
  try {
    expect((await call(`projects/${id}/design/approve`, { version: 7 })).status).toBe(400);
    expect((await call(`projects/${id}/design/approve`, { version: 1 })).status).toBe(200);
    let [project] = await db.select().from(projects).where(eq(projects.id, id));
    expect(project.status).toBe("ready");
    expect(project.designVersion).toBe(1);
    expect((await db.select().from(revisions).where(eq(revisions.projectId, id)))[0].approved).toBe(true);

    // An AI revision lands as an unapproved draft; discarding it restores the approved text.
    await db.update(projects).set({ design: "AI rewrite", designVersion: 2, status: "review" }).where(eq(projects.id, id));
    await db.insert(revisions).values({ id: crypto.randomUUID(), projectId: id, version: 2, content: "AI rewrite", author: "designer" });
    expect((await call(`projects/${id}/design/revert`, { version: 1, toVersion: 1 })).status).toBe(400);
    expect((await call(`projects/${id}/design/revert`, { version: 2, toVersion: 1 })).status).toBe(200);
    [project] = await db.select().from(projects).where(eq(projects.id, id));
    expect(project).toMatchObject({ design: "Original brief for the lifecycle fixture.", designVersion: 3, status: "ready" });
    const history = await db.select().from(revisions).where(eq(revisions.projectId, id));
    expect(history.map((r) => [r.version, r.author, r.approved]).sort()).toEqual([
      [1, "user", true], [2, "designer", false], [3, "user", true],
    ]);

    // Reverting to a draft that was never approved needs approval again.
    expect((await call(`projects/${id}/design/revert`, { version: 3, toVersion: 2 })).status).toBe(200);
    expect((await db.select().from(projects).where(eq(projects.id, id)))[0]).toMatchObject({ design: "AI rewrite", status: "review" });
    await call(`projects/${id}/design/approve`, { version: 4 });

    expect((await call(`projects/${id}/archive`, { archived: true })).status).toBe(200);
    const archived = await call(`projects/${id}/generate`, { count: 1, judgeIterations: 0 });
    expect(archived.status).toBe(400);
    expect((await archived.json()).error).toContain("archived");
    expect((await call(`projects/${id}/archive`, { archived: false })).status).toBe(200);
    expect((await call(`projects/${id}/generate`, { count: 1, judgeIterations: 0 })).status).toBe(201);
  } finally {
    const rows = await db.select().from(batches).where(eq(batches.projectId, id));
    for (const row of rows) await db.delete(jobs).where(eq(jobs.targetId, row.id));
    await db.delete(batches).where(eq(batches.projectId, id));
    await remove(id);
  }
});

integration("only projects without generated work can be deleted", async () => {
  const empty = await createProject("Delete fixture", "Nothing generated yet.");
  const busy = await createProject("Keep fixture", "Has a batch.");
  try {
    await call(`projects/${busy}/design/approve`, { version: 1 });
    expect((await call(`projects/${busy}/generate`, { count: 1, judgeIterations: 0 })).status).toBe(201);
    const refused = await call(`projects/${busy}`, undefined, "DELETE");
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain("Archive");
    expect(await db.select().from(projects).where(eq(projects.id, busy))).toHaveLength(1);

    expect((await call(`projects/${empty}`, undefined, "DELETE")).status).toBe(200);
    expect(await db.select().from(projects).where(eq(projects.id, empty))).toHaveLength(0);
    expect(await db.select().from(revisions).where(eq(revisions.projectId, empty))).toHaveLength(0);
    expect((await call(`projects/${empty}`, undefined, "DELETE")).status).toBe(404);
  } finally {
    const rows = await db.select().from(batches).where(eq(batches.projectId, busy));
    for (const row of rows) await db.delete(jobs).where(eq(jobs.targetId, row.id));
    await db.delete(models).where(eq(models.projectId, busy));
    await db.delete(batches).where(eq(batches.projectId, busy));
    await remove(busy);
    await remove(empty);
  }
});
