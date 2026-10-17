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
