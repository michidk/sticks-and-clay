import { test, expect } from "bun:test";
import {
  workshopSchema,
  workshopContext,
  mockupReferences,
  referenceNotesFor,
  constructionGuides,
  svgGuides,
  svgIntentOf,
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
test("bounded variation and effort produce an explicit lower-priority snapshot", () => {
  expect(workshopSchema.safeParse({ variation: 101 }).success).toBe(false);
  const draft = workshopSchema.parse({ effort: "thorough" });
  expect(workshopContext(draft)).toContain("up to 5");
  expect(workshopContext(draft)).toContain("take precedence");
});
test("batches saved with accepted mockups keep them as lower-priority direction and extra references", () => {
  const snapshot = {
    ...workshopSchema.parse({}),
    mockups: [
      { key: "mockups/a.png", note: "thin outlines" },
      { key: "mockups/b.png", note: "" },
    ],
  };
  const context = workshopContext(snapshot);
  expect(context).toContain("last 2 supplied reference images are mockups");
  expect(context).toContain("mockup 1: thin outlines");
  expect(context).toContain("mockup 2: accepted without comment");
  expect(context).toContain("take precedence");
  expect(mockupReferences(snapshot)).toEqual(["mockups/a.png", "mockups/b.png"]);
  expect(mockupReferences(null)).toEqual([]);
});
test("reference notes are numbered by position among the project references", () => {
  const notes = referenceNotesFor(["r/a.png", "r/b.png", "r/c.png"], { "r/b.png": " keep the thin lines ", "r/c.png": "  ", "r/gone.png": "stale" });
  expect(notes).toEqual([{ position: 2, note: "keep the thin lines" }]);
  const context = workshopContext({ ...workshopSchema.parse({}), referenceNotes: notes });
  expect(context).toContain("project reference 2: keep the thin lines");
  expect(workshopContext(workshopSchema.parse({}))).not.toContain("Reference image notes");
});
test("batches saved with style memory keep showing it to their prompts", () => {
  const context = workshopContext({ ...workshopSchema.parse({}), memory: "legacy rule", style: "sage matte" });
  expect(context).toContain("legacy rule");
  expect(context).toContain("sage matte");
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

test("style comparisons detect palette and image-count drift without depending on material order", () => {
  const material = (color: number[]) => ({
    pbrMetallicRoughness: { baseColorFactor: color },
  });
  const reference = measureStyle({
    materials: [material([1, 0, 0, 1]), material([0, 1, 0, 1])],
    images: [{}],
  });
  const reordered = measureStyle({
    materials: [material([0, 1, 0, 1]), material([1, 0, 0, 1])],
    images: [{}],
  });
  expect(compareStyle(reordered, [{ style: reference }], 0).warnings).toEqual(
    [],
  );
  const drift = measureStyle({
    materials: [material([0, 0, 1, 1])],
    images: [{}, {}],
  });
  const warnings = compareStyle(drift, [{ style: reference }], 0).warnings;
  expect(warnings.some((warning) => warning.includes("baseColors"))).toBe(true);
  expect(warnings.some((warning) => warning.includes("imageCount"))).toBe(true);
});

test("SVG batches without an intent are icons, and an explicit intent reaches the prompts", () => {
  expect(svgIntentOf(workshopSchema.parse({}))).toBe("icon");
  expect(svgIntentOf(null)).toBe("icon");
  expect(workshopContext(workshopSchema.parse({}))).not.toContain("SVG intent");
  const logo = workshopSchema.parse({ svgIntent: "logo" });
  expect(workshopContext(logo)).toContain("SVG intent: logo");
  expect(workshopSchema.safeParse({ svgIntent: "mural" }).success).toBe(false);
  expect(svgGuides("builder", "icon")).toEqual(["svg/builder-icon", "references/svg-construction"]);
  expect(svgGuides("judge", "logo")).toEqual(["svg/judge-logo"]);
});
