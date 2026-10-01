import { test, expect } from "bun:test";
import { api } from "./api.server";
import { db } from "../db/client";
import { projects, revisions } from "../db/schema";
import { eq } from "drizzle-orm";
// Opt in against an isolated migrated database with no worker; fixtures clean up queued jobs.
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
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
  // Run only on an isolated test database without a worker: creation queues design.
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
      const queued = await db.select().from(jobs).where(eq(jobs.targetId, id));
      expect(queued).toHaveLength(1);
      expect(queued[0].kind).toBe("design");
    } finally {
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
        await db.delete(batches).where(eq(batches.id, batchId));
      }
    }
  } finally {
    await db.delete(projects).where(eq(projects.id, id));
  }
});
