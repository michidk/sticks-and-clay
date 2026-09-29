import { test, expect } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, runs } from "../db/schema";
import { DATA } from "./storage.server";
import { archiveVersion } from "./versions.server";
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration(
  "version archives generated sources and exact embedded textures; replay retains original images",
  async () => {
    const id = crypto.randomUUID(),
      runId = crypto.randomUUID();
    const directory = `test-textures/${id}`;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFcAAAAASUVORK5CYII=",
      "base64",
    );
    let json = JSON.stringify({
      images: [{ name: "Stone normal", mimeType: "image/png", bufferView: 0 }],
      bufferViews: [{ byteOffset: 0, byteLength: png.length }],
    });
    json = json.padEnd(Math.ceil(json.length / 4) * 4, " ");
    const header = Buffer.alloc(20),
      binHeader = Buffer.alloc(8);
    header.write("glTF");
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + json.length + png.length, 8);
    header.writeUInt32LE(json.length, 12);
    header.write("JSON", 16);
    binHeader.writeUInt32LE(png.length, 0);
    binHeader.write("BIN", 4);
    await db
      .insert(projects)
      .values({ id, name: "Texture archive fixture", description: "test" });
    await db
      .insert(runs)
      .values({
        id: runId,
        projectId: id,
        role: "builder",
        model: "fixture",
        promptVersion: "test",
        systemPrompt: "test",
        input: "test",
        result: { summary: "fixture" },
        rates: { input: 0, cached: 0, output: 0, source: "test" },
      });
    try {
      await mkdir(resolve(DATA, directory, "textures"), { recursive: true });
      await writeFile(resolve(DATA, directory, "textures/stone.png"), png);
      await writeFile(
        resolve(DATA, directory, "asset.glb"),
        Buffer.concat([header, Buffer.from(json), binHeader, png]),
      );
      for (const file of [
        "source.blend",
        "front.png",
        "rear.png",
        "detail.png",
      ])
        await writeFile(resolve(DATA, directory, file), png);
      await writeFile(resolve(DATA, directory, "metrics.json"), "{}");
      const first = await archiveVersion(runId, directory);
      expect(first.textures).toHaveLength(2);
      expect(await readFile(resolve(DATA, first.textures[1].key))).toEqual(png);
      await writeFile(
        resolve(DATA, directory, "textures/stone.png"),
        "changed",
      );
      const replay = await archiveVersion(runId, directory);
      expect(await readFile(resolve(DATA, replay.textures[0].key))).toEqual(
        png,
      );
    } finally {
      await db.delete(runs).where(eq(runs.id, runId));
      await db.delete(projects).where(eq(projects.id, id));
      await rm(resolve(DATA, directory), { recursive: true, force: true });
      await rm(resolve(DATA, "versions", runId), {
        recursive: true,
        force: true,
      });
    }
  },
);
