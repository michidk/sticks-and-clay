import { test, expect } from "bun:test";
import { Document, NodeIO } from "@gltf-transform/core";
import { cleanupGlb } from "./cleanup";

async function fixture(blend = false) {
  const d = new Document(),
    b = d.createBuffer();
  const positions = d
    .createAccessor()
    .setType("VEC3")
    .setArray(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]),
    )
    .setBuffer(b);
  const uv = d
    .createAccessor()
    .setType("VEC2")
    .setArray(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 0.5, 0, 0, 1]))
    .setBuffer(b);
  const mat = d
    .createMaterial("paint")
    .setBaseColorFactor([0.1, 0.2, 0.3, 1])
    .setAlphaMode(blend ? "BLEND" : "OPAQUE");
  const p = d
    .createPrimitive()
    .setAttribute("POSITION", positions)
    .setAttribute("TEXCOORD_0", uv)
    .setMaterial(mat);
  const indices = d
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Uint16Array([0, 1, 2, 3, 4, 5]))
    .setBuffer(b);
  p.setIndices(indices);
  d.createScene().addChild(
    d.createNode("piece").setMesh(d.createMesh("geometry").addPrimitive(p)),
  );
  d.createMaterial("unused");
  return new NodeIO().writeBinary(d);
}
async function gridFixture(size = 40) {
  const d = new Document(),
    b = d.createBuffer(),
    positions = new Float32Array((size + 1) * (size + 1) * 3),
    indices = new Uint32Array(size * size * 6);
  for (let y = 0; y <= size; y++)
    for (let x = 0; x <= size; x++) {
      const i = (y * (size + 1) + x) * 3;
      positions[i] = x / size;
      positions[i + 1] = y / size;
    }
  let offset = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const a = y * (size + 1) + x,
        b = a + 1,
        c = a + size + 1,
        d = c + 1;
      indices.set([a, b, d, a, d, c], offset);
      offset += 6;
    }
  const primitive = d
    .createPrimitive()
    .setAttribute(
      "POSITION",
      d.createAccessor().setType("VEC3").setArray(positions).setBuffer(b),
    )
    .setIndices(
      d.createAccessor().setType("SCALAR").setArray(indices).setBuffer(b),
    );
  d.createScene().addChild(
    d.createNode("grid").setMesh(d.createMesh("dense-grid").addPrimitive(primitive)),
  );
  return new NodeIO().writeBinary(d);
}
function triangles(d: Document) {
  const p = d.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = p.getAttribute("POSITION")!,
    uv = p.getAttribute("TEXCOORD_0")!,
    idx = p.getIndices()!;
  const rows = [];
  for (let i = 0; i < idx.getCount(); i += 3) {
    const triangle: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const n = idx.getScalar(i + k);
      triangle.push([...pos.getElement(n, []), ...uv.getElement(n, [])]);
    }
    // Index optimizer may cyclically rotate triangles, preserving orientation.
    const rotations = [0, 1, 2].map((k) =>
      JSON.stringify([...triangle.slice(k), ...triangle.slice(0, k)]),
    );
    rows.push(rotations.sort()[0]);
  }
  return rows.sort();
}
test("cleanup welds identical indexed vertices but preserves UV seams, geometry and paint", async () => {
  const io = new NodeIO(),
    input = await fixture(),
    saved = input.slice();
  const result = await cleanupGlb(input);
  expect(result.cleanup.status).toBe("applied");
  expect(input).toEqual(saved);
  const before = await io.readBinary(input),
    after = await io.readBinary(result.bytes);
  expect(triangles(after)).toEqual(triangles(before));
  expect(
    after
      .getRoot()
      .listMeshes()[0]
      .listPrimitives()[0]
      .getAttribute("POSITION")!
      .getCount(),
  ).toBe(4);
  expect(
    after
      .getRoot()
      .listMaterials()
      .map((m) => m.getName()),
  ).toEqual(["paint"]);
  expect(after.getRoot().listMaterials()[0].getBaseColorFactor()).toEqual(
    before.getRoot().listMaterials()[0].getBaseColorFactor(),
  );
});
test("cleanup simplifies large meshes and reports the published triangle count", async () => {
  const io = new NodeIO(),
    input = await gridFixture(),
    before = await io.readBinary(input),
    result = await cleanupGlb(input),
    after = await io.readBinary(result.bytes);
  const beforeCount =
    before.getRoot().listMeshes()[0].listPrimitives()[0].getIndices()!.getCount() /
    3;
  const afterCount =
    after.getRoot().listMeshes()[0].listPrimitives()[0].getIndices()!.getCount() /
    3;
  expect(result.cleanup.status).toBe("applied");
  expect("steps" in result.cleanup ? result.cleanup.steps : []).toContain(
    "simplify-large-opaque-meshes",
  );
  expect(afterCount).toBeLessThanOrEqual(beforeCount * 0.5);
  expect(
    "triangles" in result.cleanup ? result.cleanup.triangles : undefined,
  ).toEqual({ before: beforeCount, after: afterCount });
});
test("transparent triangles retain order and skip meshoptimizer", async () => {
  const input = await fixture(true);
  const result = await cleanupGlb(input);
  expect(result.cleanup.status).toBe("applied");
  expect("steps" in result.cleanup ? result.cleanup.steps : []).not.toContain(
    "reorder-indices",
  );
  const d = await new NodeIO().readBinary(result.bytes);
  expect([
    ...d
      .getRoot()
      .listMeshes()[0]
      .listPrimitives()[0]
      .getIndices()!
      .getArray()!,
  ]).toEqual([0, 1, 2, 0, 3, 2]);
});
test("unsupported extension semantics and malformed files preserve exact bytes", async () => {
  const io = new NodeIO();
  const input = await fixture();
  const json = await io.binaryToJSON(input);
  json.json.extensionsUsed = ["VENDOR_unknown"];
  // Build GLB directly to avoid dropping the unknown extension through NodeIO.
  const j = Buffer.from(JSON.stringify(json.json));
  const pad = Buffer.alloc(Math.ceil(j.length / 4) * 4, 32);
  j.copy(pad);
  const old = Buffer.from(input),
    tail = old.subarray(20 + old.readUInt32LE(12));
  const header = Buffer.from(old.subarray(0, 20));
  header.writeUInt32LE(20 + pad.length + tail.length, 8);
  header.writeUInt32LE(pad.length, 12);
  const extended = Buffer.concat([header, pad, tail]);
  expect((await cleanupGlb(extended)).bytes).toEqual(extended);
  const invalid = new Uint8Array([1, 2, 3]);
  expect((await cleanupGlb(invalid)).bytes).toEqual(invalid);
});
test("cleanup preserves embedded image bytes, material bindings, normals and node transforms", async () => {
  const io = new NodeIO(),
    doc = await io.readBinary(await fixture());
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFcAAAAASUVORK5CYII=",
    "base64",
  );
  const texture = doc
    .createTexture("atlas")
    .setImage(png)
    .setMimeType("image/png");
  const mat = doc.getRoot().listMaterials()[0];
  mat
    .setBaseColorTexture(texture)
    .setNormalTexture(texture)
    .setNormalScale(0.25);
  const p = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  p.setAttribute(
    "NORMAL",
    doc
      .createAccessor()
      .setBuffer(doc.getRoot().listBuffers()[0])
      .setType("VEC3")
      .setArray(
        new Float32Array([
          0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 1, 0, 0, 1,
        ]),
      ),
  );
  doc.getRoot().listNodes()[0].setTranslation([5, 6, 7]);
  const result = await cleanupGlb(await io.writeBinary(doc));
  expect(result.cleanup.status).toBe("applied");
  const after = await io.readBinary(result.bytes);
  expect(Buffer.from(after.getRoot().listTextures()[0].getImage()!)).toEqual(
    png,
  );
  expect(after.getRoot().listMaterials()[0].getNormalScale()).toBe(0.25);
  expect(after.getRoot().listMaterials()[0].getBaseColorTexture()).toBe(
    after.getRoot().listMaterials()[0].getNormalTexture(),
  );
  expect(after.getRoot().listNodes()[0].getTranslation()).toEqual([5, 6, 7]);
  const normals = after
    .getRoot()
    .listMeshes()[0]
    .listPrimitives()[0]
    .getAttribute("NORMAL")!;
  expect(normals.getCount()).toBe(5); // Opposite normal at otherwise identical position/UV remains split.
  expect(Array.from(normals.getArray()!)).toContain(-1);
});

test("reordering leaves no unreferenced accessors or buffer views", async () => {
  const result = await cleanupGlb(await fixture());
  const { json } = await new NodeIO().binaryToJSON(result.bytes);
  const used = new Set(
    json.meshes!.flatMap((m) =>
      m.primitives.flatMap((p) => [p.indices, ...Object.values(p.attributes)]),
    ),
  );
  expect(json.accessors!.every((_, i) => used.has(i))).toBe(true);
  const views = new Set(json.accessors!.map((a) => a.bufferView));
  expect(json.bufferViews!.every((_, i) => views.has(i))).toBe(true);
});
