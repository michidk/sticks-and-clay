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
