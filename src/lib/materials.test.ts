import { expect, test } from "bun:test";
import { materialSchema, spriteOptionsSchema } from "./materials";
test("material parameters preserve physical bounds and seeds", () => {
  expect(materialSchema.parse({}).seed).toBe(1);
  for (const input of [
    { seed: -1 },
    { size: 4096 },
    { reliefMm: 0 },
    { roughness: NaN },
    { color: "red" },
  ])
    expect(materialSchema.safeParse(input).success).toBe(false);
});
test("sprite choices bound sheets, palettes and timing", () => {
  expect(spriteOptionsSchema.parse({}).pixel).toBe(true);
  for (const input of [
    { directions: 20 },
    { frameCount: 32 },
    { palette: ["red", "blue"] },
    { outline: "green" },
    { fps: 0 },
  ])
    expect(spriteOptionsSchema.safeParse(input).success).toBe(false);
});
