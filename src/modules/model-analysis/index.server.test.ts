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

blenderTest(
  "raw GLB defects survive analysis and UV checks follow each material binding",
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "studio-raw-test-"));
    try {
      for (const scenario of ["defects", "valid-uv1", "invalid-uv1"]) {
        const d = new Document(),
          b = d.createBuffer();
        const p = d.createPrimitive().setAttribute(
          "POSITION",
          d
            .createAccessor()
            .setBuffer(b)
            .setType("VEC3")
            .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
        );
        if (scenario === "defects") {
          p.setIndices(
            d
              .createAccessor()
              .setBuffer(b)
              .setType("SCALAR")
              .setArray(new Uint16Array([0, 1, 2, 0, 1, 2, 0, 0, 1])),
          );
        } else {
          const good = [0, 0, 1, 0, 0, 1],
            bad = [0, 0, 0, 0, 0, 0];
          p.setAttribute(
            "TEXCOORD_0",
            d
              .createAccessor()
              .setBuffer(b)
              .setType("VEC2")
              .setArray(
                new Float32Array(scenario === "valid-uv1" ? bad : good),
              ),
          );
          p.setAttribute(
            "TEXCOORD_1",
            d
              .createAccessor()
              .setBuffer(b)
              .setType("VEC2")
              .setArray(
                new Float32Array(scenario === "valid-uv1" ? good : bad),
              ),
          );
          const texture = d
            .createTexture()
            .setMimeType("image/png")
            .setImage(
              Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFcAAAAASUVORK5CYII=",
                "base64",
              ),
            );
          const material = d.createMaterial().setBaseColorTexture(texture);
          material.getBaseColorTextureInfo()!.setTexCoord(1);
          p.setMaterial(material);
        }
        d.createScene().addChild(
          d.createNode(scenario).setMesh(d.createMesh().addPrimitive(p)),
        );
        const source = await new NodeIO().writeBinary(d),
          path = resolve(directory, scenario + ".glb");
        await writeFile(path, source);
        const result = await analyzeModel(path);
        const codes = result.findings.map((f: { code: string }) => f.code);
        if (scenario === "defects") {
          expect(codes).toContain("duplicate_or_coincident_triangles");
          expect(codes).toContain("degenerate_triangles");
          expect(
            result.findings.find(
              (f: { code: string }) => f.code === "degenerate_triangles",
            ).faces,
          ).toEqual([{ primitive: 0, triangle: 2 }]);
        } else if (scenario === "valid-uv1")
          expect(codes).not.toContain("collapsed_or_nonfinite_uv");
        else
          expect(result.findings).toContainEqual(
            expect.objectContaining({
              code: "collapsed_or_nonfinite_uv",
              material: 0,
              texCoord: 1,
              slot: "pbrMetallicRoughness.baseColorTexture",
            }),
          );
        expect(await readFile(path)).toEqual(Buffer.from(source));
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);

blenderTest(
  "native intersection termination retains completed fast findings",
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "studio-partial-test-"));
    const previous = process.env.ANALYSIS_PYTHON;
    try {
      const wrapper = resolve(directory, "terminate-python");
      await writeFile(
        wrapper,
        `#!${resolve(".venv/bin/python")}\nimport os, signal, sys, runpy\nimport igl.copyleft.cgal as cgal\ndef terminate(*args, **kwargs):\n    os.kill(os.getpid(), signal.SIGTERM)\ncgal.remesh_self_intersections = terminate\nsys.argv = sys.argv[1:]\nrunpy.run_path(sys.argv[0], run_name='__main__')\n`,
        { mode: 0o755 },
      );
      process.env.ANALYSIS_PYTHON = wrapper;
      const d = new Document(),
        b = d.createBuffer();
      const p = d.createPrimitive().setAttribute(
        "POSITION",
        d
          .createAccessor()
          .setBuffer(b)
          .setType("VEC3")
          .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])),
      );
      d.createScene().addChild(
        d.createNode("open").setMesh(d.createMesh().addPrimitive(p)),
      );
      const path = resolve(directory, "asset.glb");
      await writeFile(path, await new NodeIO().writeBinary(d));
      const result = await analyzeModel(path);
      expect(result.findings).toContainEqual(
        expect.objectContaining({ code: "open_boundary", count: 3 }),
      );
      expect(
        result.unavailable.some((s: string) =>
          s.includes("self_intersections: incomplete"),
        ),
      ).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.ANALYSIS_PYTHON;
      else process.env.ANALYSIS_PYTHON = previous;
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
