import { expect, test } from "bun:test";
import { renderSvg } from "./svg-render.server";

const doc = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;

test("render measures ink margins and flags content clipped by the canvas", async () => {
  const centered = await renderSvg(doc('<circle cx="50" cy="50" r="30" fill="#284e3c"/>'));
  expect(centered.ink).toMatchObject({ empty: false, touchesEdge: [] });
  if (centered.ink.empty) throw new Error("expected ink");
  expect(centered.ink.margins.left).toBeGreaterThan(0.15);
  expect(Math.abs(centered.ink.margins.left - centered.ink.margins.right)).toBeLessThan(0.02);
  expect(centered.full.subarray(1, 4).toString()).toBe("PNG");

  const clipped = await renderSvg(doc('<rect x="-20" y="30" width="80" height="40" fill="#284e3c"/>'));
  if (clipped.ink.empty) throw new Error("expected ink");
  expect(clipped.ink.touchesEdge).toContain("left");

  expect((await renderSvg(doc(""))).ink).toEqual({ empty: true });
});

test("24-unit icons have native-size evidence and sharp enlarged vector renders", async () => {
  const sharp = (await import("sharp")).default;
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 3L21 21" stroke="black" stroke-width="0.2"/></svg>';
  const rendered = await renderSvg(source);
  expect(await sharp(rendered.icon).metadata()).toMatchObject({ width: 24, height: 24 });
  expect(await sharp(rendered.small).metadata()).toMatchObject({ width: 64, height: 64 });
  const native = await sharp(Buffer.from(source), { density: 2304 }).flatten({ background: "#ffffff" }).raw().toBuffer();
  expect((await sharp(rendered.full).removeAlpha().raw().toBuffer()).equals(native)).toBe(true);
});

test("16px theme evidence changes currentColor but preserves fixed paints and transparent holes", async () => {
  const sharp = (await import("sharp")).default;
  const source = doc('<path fill="currentColor" fill-rule="evenodd" d="M10 10H90V90H10Z M40 40H60V60H40Z"/><rect x="10" y="10" width="20" height="20" fill="#ff0000"/>');
  const output = await renderSvg(source);
  expect(await sharp(output.tiny).metadata()).toMatchObject({ width: 16, height: 16 });
  expect(await sharp(output.darkTiny).metadata()).toMatchObject({ width: 16, height: 16 });
  const pixel = async (image: Buffer, left: number, top: number) => Array.from(await sharp(image).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer());
  expect(await pixel(output.darkSmall, 12, 12)).toEqual([255, 0, 0]);
  expect(await pixel(output.small, 45, 45)).toEqual([0, 0, 0]);
  expect(await pixel(output.darkSmall, 45, 45)).toEqual([245, 245, 245]);
  expect(await pixel(output.small, 32, 32)).toEqual([255, 255, 255]);
  expect(await pixel(output.darkSmall, 32, 32)).toEqual([24, 24, 27]);
});
