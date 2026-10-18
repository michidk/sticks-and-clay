import type { PixelImage } from "./pixel";

/** Feet of a row of frames: the lowest drawn row and the middle of what is drawn in the bottom eighth of the art
 * (union over all frames), so a stride or a held item does not pull the pivot sideways. */
function feet(frames: PixelImage[]) {
  const { width: w, height: h } = frames[0];
  const drawn = (x: number, y: number) => frames.some((f) => x < f.width && y < f.height && f.rgba[(y * f.width + x) * 4 + 3] > 8);
  let top = -1, bottom = -1, left = w, right = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (drawn(x, y)) {
    if (top < 0) top = y;
    bottom = y; left = Math.min(left, x); right = Math.max(right, x);
  }
  if (bottom < 0) return { baseline: h - 1, x: (w - 1) / 2, box: { left: 0, top: 0, right: w - 1, bottom: h - 1 } };
  const band = Math.max(top, bottom - Math.max(1, Math.round((bottom - top + 1) * 0.12)) + 1);
  let footLeft = w, footRight = -1;
  for (let y = band; y <= bottom; y++) for (let x = 0; x < w; x++) if (drawn(x, y)) { footLeft = Math.min(footLeft, x); footRight = Math.max(footRight, x); }
  return { baseline: bottom, x: (footLeft + footRight) / 2, box: { left, top, right, bottom } };
}

export type SheetFrame = { name: string; x: number; y: number; width: number; height: number; direction: 0; frame: number };
export type SheetLayout = ReturnType<typeof spriteSheet>["layout"];

/** One engine-ready strip of frames. With `align`, the row moves as a whole (the animation is unchanged) so its feet
 * stand on a fixed baseline `margin` cells above the cell's bottom edge and on the cell's centre column; cells are
 * rounded up to a multiple of `multiple`. Without it the canvas is kept as drawn and the pivot is measured. The layout
 * uses the cell fields the sprite player reads (`cells`, `fps`, `loop`). */
export function spriteSheet(frames: PixelImage[], { fps = 8, loop = true, align = true, multiple = 2, margin = 1 } = {}) {
  const w0 = frames[0].width, h0 = frames[0].height;
  const { baseline, x: footX, box } = feet(frames);
  let width = w0, height = h0, dx = 0, dy = 0, pivotX = footX, pivotY = baseline;
  if (align) {
    // The narrowest cell (at least the canvas) whose centre column takes the feet with the whole drawing inside.
    width = w0 + ((multiple - (w0 % multiple)) % multiple);
    for (;;) {
      dx = Math.round((width - 1) / 2 - footX);
      if ((box.left + dx >= 0 && box.right + dx <= width - 1) || width > 4 * w0) break;
      width += multiple;
    }
    height = Math.max(h0, baseline - box.top + 1 + margin);
    height += (multiple - (height % multiple)) % multiple;
    dy = Math.round(height - 1 - margin - baseline);
    // Keep the drawing inside the cell.
    dx = Math.min(Math.max(dx, -box.left), width - 1 - box.right);
    dy = Math.min(Math.max(dy, -box.top), height - 1 - box.bottom);
    pivotX = footX + dx;
    pivotY = baseline + dy;
  }
  const sheet = new Uint8Array(width * frames.length * height * 4);
  const stride = width * frames.length;
  frames.forEach((frame, index) => {
    for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      const from = (y * frame.width + x) * 4, to = (ty * stride + index * width + tx) * 4;
      sheet.set(frame.rgba.subarray(from, from + 4), to);
    }
  });
  const cells: SheetFrame[] = frames.map((_, index) => ({
    name: frames.length > 1 ? `frame_${String(index).padStart(2, "0")}` : "sprite",
    x: index * width, y: 0, width, height, direction: 0, frame: index,
  }));
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  return {
    image: { width: stride, height, rgba: sheet } satisfies PixelImage,
    layout: {
      version: 1,
      image: "sheet.png",
      layout: "one row of frames, left to right",
      size: [stride, height] as [number, number],
      frameWidth: width,
      frameHeight: height,
      fps,
      loop,
      // The pivot: the cell (x right, y down from the cell's top-left) the feet stand on; baseline: that row.
      pivotPx: [Math.round(pivotX * 100) / 100, Math.round(pivotY * 100) / 100] as [number, number],
      baselinePx: Math.round(pivotY),
      // Unity: normalised from the cell's bottom-left, at the bottom of the pivot cell's centre.
      pivotNormalized: [round((pivotX + 0.5) / width), round(1 - (pivotY + 1) / height)] as [number, number],
      aligned: align,
      offsetPx: [dx, dy] as [number, number],
      cells,
    },
  };
}

/** Pixels per world unit: 16 for small sprites, 32 otherwise, the common tile sizes. */
const unitsFor = (layout: SheetLayout) => (Math.min(layout.frameWidth, layout.frameHeight) <= 16 ? 16 : 32);

/** The sheet as Unity's sprite importer wants it: point filtering, no compression, no mipmaps, rects from the
 * texture's bottom-left, one custom pivot, and a clip of the frames. An editor script or importer applies it; the
 * values map one to one onto TextureImporter and SpriteMetaData fields. */
export function unitySpriteMeta(layout: SheetLayout, texture: string, pixelsPerUnit = unitsFor(layout)) {
  const [, height] = layout.size;
  return {
    format: "unity-sprite-import",
    version: 1,
    texture,
    textureImporter: {
      textureType: "Sprite",
      spriteImportMode: layout.cells.length > 1 ? "Multiple" : "Single",
      spritePixelsPerUnit: pixelsPerUnit,
      filterMode: "Point",
      textureCompression: "Uncompressed",
      mipmapEnabled: false,
      alphaIsTransparency: true,
      wrapMode: "Clamp",
    },
    pivot: layout.pivotNormalized,
    pivotPx: layout.pivotPx,
    sprites: layout.cells.map((cell) => ({
      name: cell.name,
      rect: { x: cell.x, y: height - cell.y - cell.height, width: cell.width, height: cell.height },
      alignment: "Custom",
      pivot: layout.pivotNormalized,
    })),
    clips: layout.cells.length > 1 ? [{ name: "anim", fps: layout.fps, loop: layout.loop, sprites: layout.cells.map((cell) => cell.name) }] : [],
  };
}

/** A description that maps directly onto a Godot SpriteFrames resource for AnimatedSprite2D: nearest filtering, one
 * region per frame, the animation speed and loop flag, and the offset that puts the feet on the node's origin when
 * the sprite is centred. */
export function godotSpriteFrames(layout: SheetLayout, texture: string) {
  const [px, py] = layout.pivotPx;
  return {
    format: "godot-sprite-frames",
    version: 1,
    texture,
    textureFilter: "nearest",
    centered: true,
    offset: [layout.frameWidth / 2 - (px + 0.5), layout.frameHeight / 2 - (py + 1)],
    animations: [{
      name: layout.cells.length > 1 ? "anim" : "default",
      speed: layout.fps,
      loop: layout.loop,
      frames: layout.cells.map((cell) => ({ name: cell.name, region: [cell.x, cell.y, cell.width, cell.height], duration: 1 })),
    }],
  };
}
