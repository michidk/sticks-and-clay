import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Document, NodeIO } from "@gltf-transform/core";
import { analyzeModel } from "./index.server";

test("missing model is unavailable evidence, never an exception or clean pass", async () => {
  const result = await analyzeModel(`/tmp/no-model-${crypto.randomUUID()}.glb`);
  expect(result.findings).toEqual([]);
  expect(result.unavailable.length).toBeGreaterThan(0);
});
const blenderTest = process.env.BLENDER_BIN ? test : test.skip;
blenderTest(
  "adapter supplies hash-linked Blender findings without changing the GLB",
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "studio-analysis-test-"));
    try {
      const document = new Document(),
        buffer = document.createBuffer();
      const positions = document
        .createAccessor()
        .setType("VEC3")
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .setBuffer(buffer);
      const primitive = document
        .createPrimitive()
        .setAttribute("POSITION", positions);
      document
        .createScene()
        .addChild(
          document
            .createNode("Open triangle")
            .setMesh(document.createMesh().addPrimitive(primitive)),
        );
      const source = await new NodeIO().writeBinary(document);
      const path = resolve(directory, "asset.glb");
      await writeFile(path, source);
      const result = await analyzeModel(path);
      expect(result.unavailable).toEqual([]);
      expect(result.sha256).toBe(
        createHash("sha256").update(source).digest("hex"),
      );
      expect(result.findings).toContainEqual(
        expect.objectContaining({ code: "open_boundary", count: 3 }),
      );
      expect(await readFile(path)).toEqual(Buffer.from(source));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
