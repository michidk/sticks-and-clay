import { expect, test } from "bun:test";
import { exportEntries } from "./asset-export.server";

test("export collects every stored file per asset with unique, readable names", () => {
  const [first, second] = exportEntries([
    {
      id: "a", name: "Oak Chair", visualTarget: "models/a/target.png",
      artifacts: {
        glb: "versions/r1/asset.glb", blend: "versions/r1/source.blend", stage: "geometry",
        renders: ["photographs/p/front.png", "photographs/q/front.png"],
        lods: [{ glb: "versions/r1/lod1.glb" }], metrics: { origin: "ground-center", note: "a/b c.png" },
        unsafe: "versions/../secret.glb",
      },
    },
    { id: "b", name: "oak chair!", visualTarget: null, artifacts: { image: "graphics/b/sheet.svg", copy: "graphics/b/sheet.svg" } },
  ]);
  expect(Object.fromEntries(first.files)).toEqual({
    "oak-chair/asset.glb": "versions/r1/asset.glb",
    "oak-chair/source.blend": "versions/r1/source.blend",
    "oak-chair/renders/front.png": "photographs/p/front.png",
    "oak-chair/renders/front-2.png": "photographs/q/front.png",
    "oak-chair/lods/lod1.glb": "versions/r1/lod1.glb",
    "oak-chair/visual-target/target.png": "models/a/target.png",
  });
  expect(second.folder).toBe("oak-chair-2");
  expect([...second.files.keys()]).toEqual(["oak-chair-2/sheet.svg"]);
});

test("multipart files retain readable part names and a name-to-file manifest", () => {
  const [entry] = exportEntries([{
    id: "switch", name: "Wall switch", visualTarget: "graphics/s/cover.png",
    artifacts: {
      image: "graphics/s/cover.png", format: "png",
      parts: [
        { name: "Static base", key: "graphics/s/cover.png" },
        { name: "Moving lever", key: "graphics/s/generated-2.png" },
        { name: "moving lever!", key: "graphics/s/generated-3.png" },
      ],
    },
  }]);
  expect(Object.fromEntries(entry.files)).toEqual({
    "wall-switch/parts/static-base.png": "graphics/s/cover.png",
    "wall-switch/parts/moving-lever.png": "graphics/s/generated-2.png",
    "wall-switch/parts/moving-lever-2.png": "graphics/s/generated-3.png",
  });
  expect(entry.parts).toEqual([
    { name: "Static base", key: "graphics/s/cover.png", file: "wall-switch/parts/static-base.png" },
    { name: "Moving lever", key: "graphics/s/generated-2.png", file: "wall-switch/parts/moving-lever.png" },
    { name: "moving lever!", key: "graphics/s/generated-3.png", file: "wall-switch/parts/moving-lever-2.png" },
  ]);
});
