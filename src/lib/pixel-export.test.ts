import { expect, test } from "bun:test";
import { godotSpriteFrames, spriteSheet, unitySpriteMeta } from "./pixel-export";

/** An 8x8 frame with a 2x4 block at columns 1-2, rows 2-5. */
function frame() {
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let y = 2; y <= 5; y++) for (let x = 1; x <= 2; x++) rgba.set([200, 40, 40, 255], (y * 8 + x) * 4);
  return { width: 8, height: 8, rgba };
}

test("the sheet moves a row of frames so the feet stand on one baseline and the centre column", () => {
  const { image, layout } = spriteSheet([frame(), frame()], { fps: 10 });
  expect([image.width, image.height]).toEqual([16, 8]);
  expect(layout).toMatchObject({ frameWidth: 8, frameHeight: 8, offsetPx: [2, 1], pivotPx: [3.5, 6], baselinePx: 6, pivotNormalized: [0.5, 0.125], fps: 10 });
  const alpha = (x: number, y: number) => image.rgba[(y * image.width + x) * 4 + 3];
  expect(alpha(3, 3)).toBe(255); // was (1, 2)
  expect(alpha(1, 2)).toBe(0);
  expect(alpha(8 + 4, 6)).toBe(255); // the second frame, same offset
  expect(layout.cells.map((cell) => [cell.name, cell.x, cell.frame, cell.direction])).toEqual([["frame_00", 0, 0, 0], ["frame_01", 8, 1, 0]]);
  expect(spriteSheet([frame()], { align: false }).layout).toMatchObject({ offsetPx: [0, 0], pivotPx: [1.5, 5], cells: [{ name: "sprite" }] });
});

test("Unity rects count from the bottom-left and use point filtering; Godot gets regions and a feet offset", () => {
  const { layout } = spriteSheet([frame(), frame()], { fps: 10, loop: false });
  const unity = unitySpriteMeta(layout, "sheet.png");
  expect(unity.textureImporter).toMatchObject({ filterMode: "Point", textureCompression: "Uncompressed", spriteImportMode: "Multiple", spritePixelsPerUnit: 16, mipmapEnabled: false });
  expect(unity.sprites[1]).toEqual({ name: "frame_01", rect: { x: 8, y: 0, width: 8, height: 8 }, alignment: "Custom", pivot: [0.5, 0.125] });
  expect(unity.clips).toEqual([{ name: "anim", fps: 10, loop: false, sprites: ["frame_00", "frame_01"] }]);
  expect(unitySpriteMeta(spriteSheet([frame()]).layout, "sheet.png")).toMatchObject({ clips: [], textureImporter: { spriteImportMode: "Single" } });
  const godot = godotSpriteFrames(layout, "sheet.png");
  expect(godot).toMatchObject({ textureFilter: "nearest", centered: true, offset: [0, -3], animations: [{ name: "anim", speed: 10, loop: false }] });
  expect(godot.animations[0].frames[1].region).toEqual([8, 0, 8, 8]);
});
