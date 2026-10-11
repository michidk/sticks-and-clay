import { test, expect } from "bun:test";
import {
  workshopSchema,
  workshopContext,
  constructionGuides,
} from "./workshop";
import { sourceZip } from "./source-bundle.server";
import { measureStyle, compareStyle } from "./asset-style";
test("construction context selects relevant modules", () => {
  expect(constructionGuides("a tree", "geometry")).not.toContain(
    "references/uv-and-materials",
  );
  expect(constructionGuides("an animated hinge", "surface")).toContain(
    "references/game-interfaces",
  );
});
test("bounded memory and effort produce an explicit lower-priority snapshot", () => {
  expect(workshopSchema.safeParse({ memory: "x".repeat(8001) }).success).toBe(
    false,
  );
  expect(workshopSchema.safeParse({ variation: 101 }).success).toBe(false);
  const draft = workshopSchema.parse({
    memory: "learned rule",
    effort: "thorough",
  });
  expect(workshopContext(draft)).toContain("up to 5");
  expect(workshopContext(draft)).toContain("take precedence");
});
test("source ZIP stores multiple files with valid offsets and checksums", () => {
  const zip = sourceZip([
    { name: "asset.py", bytes: Buffer.from("123456789") },
    { name: "assetkit/helper.py", bytes: Buffer.from("hello") },
  ]);
  expect(zip.readUInt32LE(14)).toBe(0xcbf43926);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  const end = zip.length - 22;
  expect(zip.readUInt16LE(end + 8)).toBe(2);
  expect(zip.readUInt32LE(zip.readUInt32LE(end + 16))).toBe(0x02014b50);
  expect(() =>
    sourceZip([{ name: "../secret", bytes: Buffer.from("x") }]),
  ).toThrow();
});
test("material comparisons are advisory and expose their measurement limits", () => {
  const style = measureStyle({
    materials: [
      { pbrMetallicRoughness: { roughnessFactor: 0.9, metallicFactor: 0 } },
    ],
  });
  expect(
    compareStyle(style, [{ style: { roughness: [0.1], metallic: [0] } }], 0)
      .warnings,
  ).toHaveLength(1);
  expect(style.limitations[0]).toContain("image pixels");
});
