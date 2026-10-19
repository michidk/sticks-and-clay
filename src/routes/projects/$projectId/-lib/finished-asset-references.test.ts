import { expect, test } from "bun:test";
import { finishedAssetReferences } from "./finished-asset-references";

const version = (id: string, artifacts: Record<string, unknown>, status = "done") => ({
  id, assetId: id, name: "Test_asset", status, artifacts, createdAt: "2026-10-19",
});
const run = (modelId: string, key: string) => ({
  id: "run", modelId, status: "done", role: "svg",
  result: { key, previews: [{ key: "views/front.png", label: "Front" }, { key: "views/side.png", label: "Side" }] },
});

test("finished graphics use the actual image and multipart images remain selectable", () => {
  expect(finishedAssetReferences([version("image", { image: "image.png" }), version("parts", {
    image: "cover.png", parts: [{ name: "Left", key: "left.png" }, { name: "Right", key: "right.png" }],
  })], [run("image", "image.png")])).toEqual([
    { key: "image.png", label: "Image", name: "Test asset", versionId: "image" },
    { key: "left.png", label: "Left", name: "Test asset", versionId: "parts" },
    { key: "right.png", label: "Right", name: "Test asset", versionId: "parts" },
  ]);
});

test("models use photos and SVG and CAD use raster previews belonging to the finished output", () => {
  expect(finishedAssetReferences([
    version("model", { renders: ["model/front.png", "model/rear.png"] }),
    version("svg", { image: "svg/source.svg" }),
    version("cad", { image: "cad/iso.png", format: "cad" }),
  ], [run("svg", "old.svg"), run("svg", "svg/source.svg"), run("cad", "cad/iso.png")]).map(({ key }) => key))
    .toEqual(["model/front.png", "model/rear.png", "svg/preview.png", "views/front.png", "views/side.png"]);
});

test("unfinished assets, obsolete versions and non-image artifacts are excluded", () => {
  expect(finishedAssetReferences([
    { ...version("old", { image: "old.png" }), assetId: "same", createdAt: "2026-10-18" },
    { ...version("new", { image: "new.png" }), assetId: "same" },
    version("busy", { image: "draft.png" }, "building"),
    version("failed", { image: "failed.png" }, "failed"),
    version("source", { image: "asset.glb" }),
    version("none", { glb: "asset.glb" }),
  ], []).map(({ key }) => key)).toEqual(["new.png"]);
});

test("legacy SVG versions use the saved full-size raster even when run results omit previews", () => {
  expect(finishedAssetReferences([version("svg", { image: "graphics/iteration-2/graphic.svg" })], []))
    .toEqual([{ key: "graphics/iteration-2/preview.png", label: "Image", name: "Test asset", versionId: "svg" }]);
});
