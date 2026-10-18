import { test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, jobs } from "../db/schema";
import { api } from "./api.server";
import { renderMaterial } from "./materials.server";
import { jobContext } from "./checkpoint.server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DATA } from "./storage.server";
import { materialSchema } from "./materials";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration(
  "material jobs freeze recipes, publish actual maps and resume without overwriting history",
  async () => {
    const projectId = crypto.randomUUID();
    await db
      .insert(projects)
      .values({
        id: projectId,
        name: "Material test",
        description: "Physical material test",
        status: "ready",
        design: "Muted stone",
        designVersion: 2,
      });
    try {
      const send = (path: string, body?: unknown) =>
        api(
          new Request(
            `http://localhost/api/${path}`,
            body
              ? {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                }
              : undefined,
          ),
        );
      expect(
        (
          await send(`projects/${projectId}/materials`, {
            parameters: { seed: -1 },
          })
        ).status,
      ).toBe(400);
      const parameters = materialSchema.parse({
        size: 64,
        recipe: "gravel",
        seed: 72,
      });
      const response = await send(`projects/${projectId}/materials`, {
        parameters,
      });
      expect(response.status).toBe(201);
      const { id } = await response.json();
      const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
      expect(job.checkpoint.design).toBe("Muted stone");
      await db
        .update(projects)
        .set({ design: "Changed later" })
        .where(eq(projects.id, projectId));
      await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, id));
      await jobContext.run({ id, checkpoint: { ...job.checkpoint } }, () =>
        renderMaterial(projectId),
      );
      await db.update(jobs).set({ status: "done" }).where(eq(jobs.id, id));
      const [saved] = await db.select().from(jobs).where(eq(jobs.id, id));
      const files = JSON.parse(saved.checkpoint.files);
      for (const name of ["hdrp_mask.png", "urp_metallic_smoothness.png", "normal_dx.png"])
        expect(files).toContain(`materials/${id}/output/${name}`);
      expect(files).toContain(`materials/${id}/output/height.png`);
      expect(
        (
          await readFile(resolve(DATA, `materials/${id}/output/height.png`))
        )[24],
      ).toBe(16);
      const metadata = JSON.parse(
        await readFile(
          resolve(DATA, `materials/${id}/output/material.json`),
          "utf8",
        ),
      );
      expect(metadata.parameters).toEqual(parameters);
      expect(metadata.validation.normalConvention).toContain("OpenGL +Y");
      const zip = await readFile(resolve(DATA, `materials/${id}/source.zip`));
      expect(zip.readUInt32LE()).toBe(0x04034b50);
      expect(zip.includes(Buffer.from("materialkit.py"))).toBe(true);
      const before = await readFile(
        resolve(DATA, `materials/${id}/output/albedo.png`),
      );
      await jobContext.run({ id, checkpoint: { ...saved.checkpoint } }, () =>
        renderMaterial(projectId),
      );
      expect(
        await readFile(resolve(DATA, `materials/${id}/output/albedo.png`)),
      ).toEqual(before);
      const history = await (
        await send(`projects/${projectId}/materials`)
      ).json();
      expect(history[0].files).toEqual(files);
      await db
        .update(jobs)
        .set({ status: "failed", error: "Interrupted" })
        .where(eq(jobs.id, id));
      expect((await send(`queue/${id}/resume`, {})).status).toBe(200);
      const [resumed] = await db.select().from(jobs).where(eq(jobs.id, id));
      expect(resumed.checkpoint.parameters).toBe(saved.checkpoint.parameters);
      expect(resumed.checkpoint.prepared).toBe("yes");
    } finally {
      await db.delete(jobs).where(eq(jobs.targetId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  },
  30000,
);
