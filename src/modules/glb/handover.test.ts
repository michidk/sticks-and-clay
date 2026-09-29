import { test, expect } from "bun:test";
import { handoverGlb } from "./handover";
function glb(document: object) {
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const header = Buffer.alloc(20);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + 24, 8);
  header.writeUInt32LE(padded.length, 12);
  header.write("JSON", 16);
  const tail = Buffer.from([
    4, 0, 0, 0, 66, 73, 78, 0, 1, 2, 3, 4, 4, 0, 0, 0, 84, 69, 83, 84, 5, 6, 7,
    8,
  ]);
  return Buffer.concat([header, padded, tail]);
}
test("handover replaces exporter markers, preserves asset content and binary chunks, and is idempotent", () => {
  const document = {
    asset: {
      version: "2.0",
      generator: "Blender",
      copyright: "Artist license",
      extras: { exporter: "Blender", author: "Artist" },
    },
    extras: { createdBy: "Other tool", custom: 42 },
    nodes: [
      {
        name: "Blender robot",
        extras: { blenderVersion: "4.5", socket: "hand" },
      },
    ],
    extensions: { VENDOR_feature: { generator: "functional extension value" } },
    buffers: [{ byteLength: 4 }],
  };
  const input = glb(document),
    original = Buffer.from(input);
  const { bytes, receipt } = handoverGlb(input);
  expect(input).toEqual(original);
  expect(bytes.subarray(-24)).toEqual(input.subarray(-24));
  const output = JSON.parse(
    bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
  );
  expect(output.asset).toEqual({
    version: "2.0",
    generator: "Sticks & Clay",
    copyright: "Artist license",
    extras: { author: "Artist" },
  });
  expect(output.extras).toEqual({ custom: 42 });
  expect(output.nodes).toEqual([
    { name: "Blender robot", extras: { socket: "hand" } },
  ]);
  expect(output.extensions).toEqual(document.extensions);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  expect(handoverGlb(bytes).bytes).toEqual(bytes);
  expect(receipt.steps).toEqual([{ id: "generator-marker", version: 1 }]);
  expect(receipt.outputSha256).not.toBe(receipt.inputSha256);
});
test("handover rejects malformed headers and chunk boundaries before publication", () => {
  const input = glb({ asset: { version: "2.0" } });
  for (const index of [0, 4, 8, 12, 16]) {
    const corrupt = Buffer.from(input);
    corrupt[index] = 255;
    expect(() => handoverGlb(corrupt)).toThrow();
  }
  expect(() => handoverGlb(input.subarray(0, input.length - 1))).toThrow();
  expect(() => handoverGlb(glb({ asset: { version: "1.0" } }))).toThrow();
});
