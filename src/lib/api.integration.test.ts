import { test, expect } from "bun:test";
import { api } from "./api.server";
import { db } from "../db/client";
import { assetVersions, projects, revisions } from "../db/schema";
import { eq } from "drizzle-orm";
import { getStorage, upload } from "./storage.server";
// Opt in against an isolated migrated database with no worker; fixtures clean up queued jobs.
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration("design edits save references atomically, retain JSON callers and reject stale uploads", async () => {
  const id = crypto.randomUUID();
  const design =
    "# Reference style\n" + "Soft shapes and warm ivory surfaces. ".repeat(4);
  const file = new File(
    [Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFcAAAAASUVORK5CYII=",
      "base64",
    )],
    "pixel.png",
    { type: "image/png" },
  );
  const saved = await upload(file);
  const keys = [saved];
  const readProject = async () =>
    (await db.select().from(projects).where(eq(projects.id, id)))[0];
  const form = new FormData();
  form.set("design", design);
  form.set("version", "1");
  form.set("approve", "false");
  form.set("references", JSON.stringify([saved]));
  form.append("images", file);
  const save = () => api(new Request(
    `http://localhost/api/projects/${id}/design`,
    { method: "PUT", body: form },
  ));
  try {
    await db.insert(projects).values({
      id,
      name: "Design references fixture",
      description: "test",
      status: "review",
      design,
      designVersion: 1,
      references: [saved],
    });
    expect((await save()).status).toBe(200);
    const draft = await readProject();
    keys.push(...draft.references.filter((key) => key !== saved));
    expect(draft.references).toHaveLength(2);
    expect(draft.references[0]).toBe(saved);
    expect(await getStorage().exists(draft.references[1])).toBe(true);
    expect(draft.status).toBe("review");
    expect(draft.designVersion).toBe(2);
    const storedBefore = (await getStorage().list("references")).sort();
    expect((await save()).status).toBe(400);
    expect((await readProject()).references).toEqual(draft.references);
    expect((await getStorage().list("references")).sort()).toEqual(storedBefore);
    const history = await db.select().from(revisions)
      .where(eq(revisions.projectId, id));
    expect(history).toHaveLength(1);
    form.delete("images");
    form.set("version", "2");
    form.set("references", '["references/foreign.png"]');
    expect((await save()).status).toBe(400);
    form.set("references", JSON.stringify(draft.references));
    form.append("images", new File(["invalid"], "bad.png", { type: "image/png" }));
    expect((await save()).status).toBe(400);
    expect((await readProject()).designVersion).toBe(2);
    form.delete("images");
    const approved = await api(new Request(`http://localhost/api/projects/${id}/design`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ design, version: 2, approve: true }),
    }));
    expect(approved.status).toBe(200);
    expect((await readProject()).references).toEqual(draft.references);
    expect((await readProject()).status).toBe("ready");
    form.set("version", "3");
    form.set("references", "[]");
    form.set("approve", "true");
    expect((await save()).status).toBe(200);
    expect((await readProject()).references).toEqual([]);
    expect((await readProject()).status).toBe("ready");
    expect(await getStorage().exists(saved)).toBe(true);
  } finally {
    await db.delete(revisions).where(eq(revisions.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
    for (const key of keys) await getStorage().delete(key);
  }
});
integration(
  "design approval, immutable revisions and optimistic edit conflict",
  async () => {
    const id = crypto.randomUUID(),
      design =
        "# Test style\n" +
        "Warm stone, meters, ground-centered origins, 2000 triangles. ".repeat(
          4,
        );
    await db.insert(projects).values({
      id,
      name: "Integration fixture",
      description: "test",
      status: "review",
      design,
      designVersion: 1,
    });
    const send = (body: unknown) =>
      api(
        new Request(`http://localhost/api/projects/${id}/design`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    try {
      const blocked = await api(
        new Request(`http://localhost/api/projects/${id}/generate`, {
          method: "POST",
          body: JSON.stringify({
            prompt: "A useful marker",
            count: 1,
            judgeIterations: 1,
          }),
        }),
      );
      expect(blocked.status).toBe(400);
      const approved = await send({ design, version: 1, approve: true });
      expect(approved.status).toBe(200);
      const stale = await send({
        design: "Wrong revision " + design,
        version: 1,
        approve: true,
      });
      expect(stale.status).toBe(400);
      const [p] = await db.select().from(projects).where(eq(projects.id, id));
      expect(p.status).toBe("ready");
      expect(p.designVersion).toBe(2);
      expect(p.design).toBe(design);
      const history = await db
        .select()
        .from(revisions)
        .where(eq(revisions.projectId, id));
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe(design);
      const invalid = await api(
        new Request(`http://localhost/api/projects/${id}/generate`, {
          method: "POST",
          body: JSON.stringify({
            prompt: "A useful marker",
            count: 21,
            judgeIterations: 1,
          }),
        }),
      );
      expect(invalid.status).toBe(400);
    } finally {
      await db.delete(revisions).where(eq(revisions.projectId, id));
      await db.delete(projects).where(eq(projects.id, id));
    }
  },
);
integration(
  "same-origin requests work behind preview proxy; foreign origins fail",
  async () => {
    const bad = await api(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { origin: "https://attacker.example", host: "studio.example" },
      }),
    );
    expect(bad.status).toBe(403);
    const allowed = await api(
      new Request("http://localhost/api/missing", {
        method: "POST",
        headers: {
          origin: "https://studio.example",
          host: "localhost",
          "x-forwarded-host": "studio.example",
        },
      }),
    );
    expect(allowed.status).toBe(404);
  },
);

integration("project creation accepts omitted, blank and short optional briefs", async () => {
  const { jobs } = await import("../db/schema");
  // The brief is the first design reference as written; creation queues no AI job.
  for (const description of [undefined, "   ", "Oak"]) {
    const form = new FormData();
    form.set("name", "Optional brief fixture");
    if (description !== undefined) form.set("description", description);
    const response = await api(new Request("http://localhost/api/projects", {
      method: "POST", body: form,
    }));
    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: string };
    try {
      const [project] = await db.select().from(projects).where(eq(projects.id, id));
      expect(project.description).toBe(description?.trim() || "");
      expect(project).toMatchObject({
        design: description?.trim() || "# Optional brief fixture",
        designVersion: 1,
        status: "review",
      });
      expect(await db.select().from(jobs).where(eq(jobs.targetId, id))).toHaveLength(0);
    } finally {
      await db.delete(revisions).where(eq(revisions.projectId, id));
      await db.delete(jobs).where(eq(jobs.targetId, id));
      await db.delete(projects).where(eq(projects.id, id));
    }
  }
});

integration("model generation accepts optional briefs and preserves the design snapshot", async () => {
  const { batches, jobs } = await import("../db/schema");
  const id = crypto.randomUUID();
  const design = "# Approved design\nA coherent family of clay farm props.";
  await db.insert(projects).values({ id, name: "Optional model brief", description: "", status: "ready", design, designVersion: 2 });
  try {
    for (const prompt of [undefined, "   ", "Oak"]) {
      const response = await api(new Request(`http://localhost/api/projects/${id}/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, count: 2, judgeIterations: 0 }),
      }));
      expect(response.status).toBe(201);
      const { id: batchId } = await response.json() as { id: string };
      try {
        const [batch] = await db.select().from(batches).where(eq(batches.id, batchId));
        expect(batch.prompt).toBe(prompt?.trim() || "");
        expect(batch.design).toBe(design);
        expect(batch.designVersion).toBe(2);
        expect(batch.count).toBe(2);
        const queued = await db.select().from(jobs).where(eq(jobs.targetId, batchId));
        expect(queued).toHaveLength(1);
        expect(queued[0].kind).toBe("plan");
      } finally {
        await db.delete(jobs).where(eq(jobs.targetId, batchId));
        await db.delete(assetVersions).where(eq(assetVersions.batchId, batchId));
        await db.delete(batches).where(eq(batches.id, batchId));
      }
    }
  } finally {
    await db.delete(projects).where(eq(projects.id, id));
  }
});

for (const assetType of ["graphic", "svg"] as const) integration(`${assetType} projects persist their type, keep review rounds and reject sprite targets`, async () => {
  const { batches, jobs } = await import("../db/schema");
  const form = new FormData();
  form.set("name", "Graphic fixture");
  form.set("assetType", assetType);
  const created = await api(
    new Request("http://localhost/api/projects", {
      method: "POST",
      body: form,
    }),
  );
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  try {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    expect(project.assetType).toBe(assetType);
    await db
      .update(projects)
      .set({
        status: "ready",
        design: "# Graphic system\nSquare editorial illustrations in forest green.",
        designVersion: 1,
      })
      .where(eq(projects.id, id));
    const invalid = await api(
      new Request(`http://localhost/api/projects/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "", count: 1, judgeIterations: 0, spriteTarget: { size: 64 } }),
      }),
    );
    expect(invalid.status).toBe(400);
    const generated = await api(
      new Request(`http://localhost/api/projects/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "",
          count: 1,
          judgeIterations: 2,
          imageSize: "1536x1024",
        }),
      }),
    );
    expect(generated.status).toBe(201);
    const { id: batchId } = (await generated.json()) as { id: string };
    const [batch] = await db
      .select()
      .from(batches)
      .where(eq(batches.id, batchId));
    expect(batch.judgeIterations).toBe(2);
    expect(batch.imageSize).toBe("1536x1024");
  } finally {
    const projectBatches = await db
      .select()
      .from(batches)
      .where(eq(batches.projectId, id));
    for (const batch of projectBatches)
      await db.delete(jobs).where(eq(jobs.targetId, batch.id));
    await db.delete(jobs).where(eq(jobs.targetId, id));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, id));
    await db.delete(batches).where(eq(batches.projectId, id));
    await db.delete(revisions).where(eq(revisions.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
  }
});


integration("project cards report planned and generated work; queue links identify the failed model", async () => {
  const { batches, assetVersions: models, jobs } = await import("../db/schema");
  const projectId = crypto.randomUUID(), batchId = crypto.randomUUID(), modelId = crypto.randomUUID(), jobId = crypto.randomUUID();
  await db.insert(projects).values({ id: projectId, name: "UI summary fixture", description: "", status: "ready" });
  try {
    await db.insert(batches).values({ id: batchId, projectId, prompt: "Test", count: 3, judgeIterations: 0, design: "Test", designVersion: 1, status: "planning" });
    await db.insert(models).values({ id: modelId, projectId, batchId, name: "Failed fixture", prompt: "Test", status: "failed" });
    await db.insert(jobs).values({ id: jobId, targetId: modelId, kind: "model", status: "failed" });
    const list = await (await api(new Request("http://localhost/api/projects"))).json() as any;
    expect(list.projects.find((p: any) => p.id === projectId).collection).toEqual({ total: 3, queued: 0, active: 2, completed: 0, attention: 1 });
    const queue = await (await api(new Request("http://localhost/api/queue"))).json() as any;
    expect(queue.jobs.find((job: any) => job.id === jobId)).toMatchObject({ projectId, modelId, status: "failed" });
  } finally {
    await db.delete(jobs).where(eq(jobs.id, jobId));
    await db.delete(models).where(eq(models.projectId, projectId));
    await db.delete(assetVersions).where(eq(assetVersions.projectId, projectId));
    await db.delete(batches).where(eq(batches.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
  }
});
