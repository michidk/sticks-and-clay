import { expect, test } from "bun:test";
import sharp from "sharp";
import { composeSheet } from "./graphic-sheet.server";

const svg = (fill: string) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" fill="${fill}"/></svg>`);

test("the sheet grids mixed SVG and PNG assets with their names", async () => {
  const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: "#c8d8b0" } }).png().toBuffer();
  const sheet = await composeSheet([
    { name: "Cup & Saucer", image: svg("#284e3c") },
    { name: "Bean", image: svg("#8a5a3c") },
    { name: "A name that is far too long to fit on one line of the sheet", image: png },
  ]);
  const { width, height, format } = await sharp(sheet).metadata();
  // 3 assets -> 2 columns x 2 rows of 384 px cards plus 24 px gutters and 36 px labels.
  expect({ width, height, format }).toEqual({ width: 24 + 2 * 408, height: 24 + 2 * 444, format: "png" });
  const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  expect(at(2, 2)).toEqual([0xf6, 0xf4, 0xec]); // ivory gutter
  expect(at(24 + 200, 24 + 200)).toEqual([0x28, 0x4e, 0x3c]); // first card's circle
});

test("small-size collection evidence preserves the actual icon pixel size", async () => {
  const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#284e3c"/></svg>');
  const sheet = await composeSheet([{ name: "Solid", image }], 24);
  const { data, info } = await sharp(sheet).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
  expect(at(75, 76)).toEqual([255, 255, 255]);
  expect(at(76, 76)).toEqual([40, 78, 60]);
  expect(at(99, 99)).toEqual([40, 78, 60]);
  expect(at(100, 99)).toEqual([255, 255, 255]);
});
