import { test, expect } from "bun:test";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, runs } from "../db/schema";
import { DATA, getStorage } from "./storage.server";
import { archiveVersion, archivePhotography } from "./versions.server";
import { createHash } from "node:crypto";
const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration(
  "version archives generated sources and exact embedded textures; replay retains original images",
  async () => {
    const id = crypto.randomUUID(),
      runId = crypto.randomUUID(),
      photoId = crypto.randomUUID();
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
    await db.insert(runs).values({
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
    await db.insert(runs).values({
      id: photoId,
      projectId: id,
      role: "photographer",
      model: "fixture",
      promptVersion: "test",
      systemPrompt: "test",
      input: "test",
      result: { summary: "photos" },
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
      const first = await archiveVersion(runId, directory, false);
      expect(first.renders).toEqual([]);
      expect(first.textures).toHaveLength(2);
      expect(await getStorage().exists(first.glb)).toBe(true);
      expect(
        new Uint8Array(
          await (
            await getStorage().download(first.textures[1].key)
          ).arrayBuffer(),
        ),
      ).toEqual(new Uint8Array(png));
      expect(await readFile(resolve(DATA, first.textures[1].key))).toEqual(png);
      await writeFile(
        resolve(DATA, directory, "textures/stone.png"),
        "changed",
      );
      const replay = await archiveVersion(runId, directory);
      expect(await readFile(resolve(DATA, replay.textures[0].key))).toEqual(
        png,
      );
      const photoDir = `${directory}/photos`;
      await mkdir(resolve(DATA, photoDir), { recursive: true });
      const render = Buffer.from(png);
      render.writeUInt32BE(1024, 16);
      render.writeUInt32BE(1024, 20);
      const hash = (bytes: Buffer) =>
        createHash("sha256").update(bytes).digest("hex");
      const receipt = {
        glbSha256: "wrong",
        images: Object.fromEntries(
          ["front", "rear", "detail"].map((v) => [v, hash(render)]),
        ),
      };
      for (const view of ["front", "rear", "detail"])
        await writeFile(resolve(DATA, photoDir, `${view}.png`), render);
      await writeFile(
        resolve(DATA, photoDir, "photography.json"),
        JSON.stringify(receipt),
      );
      await expect(
        archivePhotography(photoId, runId, photoDir, first),
      ).rejects.toThrow("match");
      receipt.glbSha256 = hash(await readFile(resolve(DATA, first.glb)));
      await writeFile(
        resolve(DATA, photoDir, "photography.json"),
        JSON.stringify(receipt),
      );
      await writeFile(resolve(DATA, photoDir, "rear.png"), png);
      await expect(
        archivePhotography(photoId, runId, photoDir, first),
      ).rejects.toThrow("invalid");
      await writeFile(resolve(DATA, photoDir, "rear.png"), render);
      const published = await archivePhotography(
        photoId,
        runId,
        photoDir,
        first,
      );
      expect(published.renders).toHaveLength(3);
      expect(published.photography.builderRunId).toBe(runId);
      expect(await getStorage().exists(published.renders[0])).toBe(true);
      await writeFile(resolve(DATA, photoDir, "front.png"), "changed");
      const resumed = await archivePhotography(photoId, runId, photoDir, first);
      expect(await readFile(resolve(DATA, resumed.renders[0]))).toEqual(render);
      const [builder] = await db.select().from(runs).where(eq(runs.id, runId));
      expect((builder.result as any).artifacts.renders).toEqual(
        published.renders,
      );
    } finally {
      await db.delete(runs).where(eq(runs.id, photoId));
      for (const key of await getStorage().list(`photographs/${photoId}`))
        await getStorage().delete(key);
      await rm(resolve(DATA, "photographs", photoId), {
        recursive: true,
        force: true,
      });
      await db.delete(runs).where(eq(runs.id, runId));
      await db.delete(projects).where(eq(projects.id, id));
      for (const key of await getStorage().list(`versions/${runId}`))
        await getStorage().delete(key);
      await rm(resolve(DATA, directory), { recursive: true, force: true });
      await rm(resolve(DATA, "versions", runId), {
        recursive: true,
        force: true,
      });
    }
  },
);
