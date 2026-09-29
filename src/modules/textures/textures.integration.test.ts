import { test, expect } from "bun:test";
import { mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { projects, jobs, runs, events } from "../../db/schema";
import { DATA } from "../../lib/storage.server";
import { runImageRole } from "../ai/index.server";
import { generateTexture } from "./index.server";
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration(
  "texture tool persists usage, reuses its receipt, and refuses cancelled work",
  async () => {
    const projectId = crypto.randomUUID(),
      jobId = crypto.randomUUID(),
      modelId = crypto.randomUUID(),
      runId = crypto.randomUUID(),
      capability = crypto.randomUUID();
    const directory = `models/${modelId}/${jobId}/iteration-0`;
    const executable = resolve("/tmp", `imagegen-fixture-${projectId}`);
    const marker = resolve(DATA, "capabilities", capability + ".json");
    const oldPython = process.env.STUDIO_IMAGEGEN_PYTHON,
      oldKey = process.env.OPENAI_API_KEY;
    await mkdir(resolve(DATA, directory), { recursive: true });
    await mkdir(resolve(DATA, "capabilities"), { recursive: true });
    await writeFile(marker, JSON.stringify({ directory }));
    await writeFile(
      executable,
      `#!/usr/bin/env python3\nimport sys,pathlib,base64,json\npathlib.Path(sys.argv[2]).write_text(json.dumps({'input_tokens':12,'output_tokens':34}))\npathlib.Path(sys.argv[sys.argv.index('--out')+1]).write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFcAAAAASUVORK5CYII='))\n`,
    );
    await chmod(executable, 0o700);
    process.env.STUDIO_IMAGEGEN_PYTHON = executable;
    process.env.OPENAI_API_KEY = "test-only-no-network";
    await db
      .insert(projects)
      .values({ id: projectId, name: "Texture fixture", description: "test" });
    await db.insert(runs).values({
      id: runId,
      projectId,
      modelId,
      role: "builder",
      model: "fixture",
      input: "test",
      systemPrompt: "test",
      promptVersion: "test",
      rates: { input: 0, cached: 0, output: 0, source: "test" },
    });
    await db.insert(jobs).values({
      id: jobId,
      kind: "model",
      targetId: modelId,
      status: "running",
      checkpoint: { "agent:builder:0": runId },
    });
    try {
      const args = {
        capability,
        name: "stone",
        prompt: "Flat seamless stylized stone base color texture",
      };
      const first: any = await generateTexture(args);
      expect(await generateTexture(args)).toEqual(first);
      const [record] = await db
        .select()
        .from(runs)
        .where(eq(runs.id, first.runId));
      expect(record.engine).toBe("imagegen");
      expect(record.inputTokens).toBe(12);
      expect(record.outputTokens).toBe(34);
      expect(record.modelId).toBe(modelId);
      const targetArgs = {
        role: "visual-target" as const,
        name: "visual-target",
        prompt: "A coherent sculpted bird visual target",
        directory: `models/${modelId}/${jobId}/concept`,
        projectId,
        modelId,
        images: [first.key],
        assertActive: async () => {},
      };
      const target = await runImageRole(targetArgs);
      expect(await runImageRole(targetArgs)).toEqual(target);
      const [targetRun] = await db
        .select()
        .from(runs)
        .where(eq(runs.id, target.runId));
      expect(targetRun.role).toBe("visual-target");
      expect(targetRun.images).toEqual([first.key]);
      expect(targetRun.inputTokens).toBe(12);
      expect(targetRun.sessionId).toBeNull();
      await expect(
        runImageRole({
          ...targetArgs,
          assertActive: async () => {
            throw new Error("cancelled");
          },
        }),
      ).rejects.toThrow("cancelled");
      await writeFile(marker, JSON.stringify({ directory, cancelled: true }));
      await expect(generateTexture(args)).rejects.toThrow("cancelled");
    } finally {
      if (oldPython === undefined) delete process.env.STUDIO_IMAGEGEN_PYTHON;
      else process.env.STUDIO_IMAGEGEN_PYTHON = oldPython;
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
      for (const row of await db
        .select()
        .from(runs)
        .where(eq(runs.projectId, projectId)))
        await db.delete(events).where(eq(events.runId, row.id));
      await db.delete(runs).where(eq(runs.projectId, projectId));
      await db.delete(jobs).where(eq(jobs.id, jobId));
      await db.delete(projects).where(eq(projects.id, projectId));
      await rm(resolve(DATA, "models", modelId), {
        recursive: true,
        force: true,
      });
      await rm(marker, { force: true });
      await rm(executable, { force: true });
    }
  },
);
