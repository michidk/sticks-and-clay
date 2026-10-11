import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { api } from "./api.server";
import { db } from "../db/client";
import { projects, jobs } from "../db/schema";
import { upload, getStorage, imagePart } from "./storage.server";
// This test enqueues a design job. Run ONLY against an isolated migrated test DB
// with no worker attached, never against the workshop's live database.
const integration =
  process.env.TEST_REFERENCE_DATABASE === "1" ? test : test.skip;
integration(
  "saved + new references survive submission, and explicit removal clears a draft",
  async () => {
    const id = crypto.randomUUID();
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFcAAAAASUVORK5CYII=",
      "base64",
    );
    const file = new File([bytes], "pixel.png", { type: "image/png" });
    const saved = await upload(file);
    const created: string[] = [saved];
    try {
      const part = await imagePart(saved);
      expect(part.type).toBe("file");
      expect(part.mediaType).toBe("image/png");
      expect(part.data).toBe(
        "data:image/png;base64," + bytes.toString("base64"),
      );
      const response = await api(
        new Request("http://localhost/api/files/" + saved),
      );
      expect(response.headers.get("Content-Type")).toBe("image/png");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        new Uint8Array(bytes),
      );
      await db
        .insert(projects)
        .values({
          id,
          name: "Reference intake test",
          description: "Fixture only",
          status: "draft",
          references: [saved],
        });
      const form = new FormData();
      form.set("name", "Reference intake test");
      form.set("description", "Fixture only; do not generate");
      form.set("draftId", id);
      form.set("references", JSON.stringify([saved]));
      form.append("images", file);
      const submit = () =>
        api(
          new Request("http://localhost/api/projects", {
            method: "POST",
            body: form,
          }),
        );
      expect((await submit()).status).toBe(201);
      const [stored] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, id));
      created.push(...stored.references.filter((key) => key !== saved));
      expect(stored.references).toHaveLength(2);
      expect(stored.references[0]).toBe(saved);
      expect(await getStorage().exists(stored.references[1])).toBe(true);
      await db.delete(jobs).where(eq(jobs.targetId, id));
      await db
        .update(projects)
        .set({ status: "draft" })
        .where(eq(projects.id, id));
      form.delete("images");
      form.set("references", "[]");
      expect((await submit()).status).toBe(201);
      const [cleared] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, id));
      expect(cleared.references).toEqual([]);
    } finally {
      await db.delete(jobs).where(eq(jobs.targetId, id));
      await db.delete(projects).where(eq(projects.id, id));
      for (const key of created) await getStorage().delete(key);
    }
  },
);
