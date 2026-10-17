import { expect, test } from "bun:test";
import sharp from "sharp";
import { resolve } from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { DATA } from "./storage.server";
import { thumbnail } from "./thumbnail.server";

test("thumbnails are small WebP copies of stored rasters and skip everything else", async () => {
  const key = `thumbnail-test/${crypto.randomUUID()}.png`;
  await mkdir(resolve(DATA, "thumbnail-test"), { recursive: true });
  const big = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#cc8844" } }).png().toBuffer();
  await writeFile(resolve(DATA, key), big);
  try {
    const small = await thumbnail(key, 640);
    const meta = await sharp(small!).metadata();
    expect([meta.format, meta.width]).toEqual(["webp", 640]);
    expect(small!.length).toBeLessThan(big.length);
    expect(await thumbnail(key, 123)).toBeNull();
    expect(await thumbnail("x/y.svg", 640)).toBeNull();
  } finally {
    await rm(resolve(DATA, "thumbnail-test"), { recursive: true, force: true });
  }
});

test("image keys are collected from a payload, once each", async () => {
  const { imageKeys } = await import("./thumbnail.server");
  const payload = { a: "graphics/m1/a/preview.png", b: [{ c: "references/x.jpg" }, "references/x.jpg"], d: "notes.md", e: "model.glb" };
  expect(imageKeys(payload).sort()).toEqual(["graphics/m1/a/preview.png", "references/x.jpg"]);
});

test("pixel art is enlarged by whole numbers without smoothing and stays lossless", async () => {
  const key = `thumbnail-test/${crypto.randomUUID()}.png`;
  await mkdir(resolve(DATA, "thumbnail-test"), { recursive: true });
  const raw = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
  await writeFile(resolve(DATA, key), await sharp(raw, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer());
  try {
    const big = await sharp((await thumbnail(key, 640))!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([big.info.width, big.info.height]).toEqual([640, 640]); // 2 cells x 320
    const at = (x: number, y: number) => [...big.data.subarray((y * 640 + x) * 4, (y * 640 + x) * 4 + 4)];
    expect(at(0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(319, 319)).toEqual([255, 0, 0, 255]); // the whole cell is one color, right up to its edge
    expect(at(320, 0)).toEqual([0, 255, 0, 255]);
    expect(at(0, 320)).toEqual([0, 0, 255, 255]);
    expect(at(639, 639)).toEqual([255, 255, 0, 255]);
    expect((await sharp((await thumbnail(key, 320))!).metadata()).width).toBe(320);
  } finally {
    await rm(resolve(DATA, "thumbnail-test"), { recursive: true, force: true });
  }
});
