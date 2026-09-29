import { test, expect } from "bun:test";
import { api } from "./api.server";
import { db } from "../db/client";
import { projects, revisions } from "../db/schema";
import { eq } from "drizzle-orm";
// Opt in against a migrated local database; fixtures never enqueue agents.
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
