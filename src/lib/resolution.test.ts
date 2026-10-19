import { expect, test } from "bun:test";
import { resolutionSchema } from "./contracts";
import { imageCanvas, validateResolution } from "./resolution";
import { assetSnapshot } from "./asset-snapshot.server";
import { generationInput } from "./api-inputs";
import { workshopSchema, workshopContext } from "./workshop";

const project = { references: [], referenceNotes: {}, workshop: workshopSchema.parse({ resolution: { width: 32, height: 48 } }) };
const asset = { references: [], referenceNotes: {}, input: generationInput.parse({ count: 1, judgeIterations: 0 }) };

test("resolution inherits, overrides, clears, and freezes project direction", () => {
  const inherited = assetSnapshot(project, asset);
  expect(inherited.resolution).toEqual({ width: 32, height: 48 });
  expect(workshopContext(inherited)).toContain("32×48 pixels");
  const override = { ...asset, input: { ...asset.input, resolution: { width: 16, height: 16 } } };
  const frozen = assetSnapshot(project, override);
  expect(frozen.resolution).toEqual({ width: 16, height: 16 });
  const changed = { ...project, workshop: workshopSchema.parse({ resolution: { width: 64, height: 64 } }) };
  expect(assetSnapshot(changed, asset, frozen).resolution).toEqual({ width: 32, height: 48 });
  expect(assetSnapshot(changed, asset).resolution).toEqual({ width: 64, height: 64 });
  expect(frozen.resolution).toEqual({ width: 16, height: 16 });
  expect(assetSnapshot({ ...project, workshop: null }, asset).resolution).toBeUndefined();
});

test("resolution validates dimensions and asset type", () => {
  for (const value of [{ width: 0, height: 32 }, { width: 4.5, height: 32 }, { width: 32 }, { width: 8193, height: 32 }])
    expect(resolutionSchema.safeParse(value).success).toBe(false);
  expect(() => validateResolution("pixel", { width: 129, height: 32 })).toThrow("128");
  expect(() => validateResolution("svg", { width: 32, height: 32 })).toThrow("only");
  expect(() => validateResolution("pixel", { width: 128, height: 4 })).not.toThrow();
});

test("image API uses a supported canvas near the requested aspect ratio", () => {
  expect(imageCanvas({ width: 1920, height: 1080 }, "1024x1024")).toBe("1536x1024");
  expect(imageCanvas({ width: 720, height: 1280 }, "1024x1024")).toBe("1024x1536");
  expect(imageCanvas({ width: 512, height: 512 }, "1536x1024")).toBe("1024x1024");
  expect(imageCanvas(undefined, "1536x1024")).toBe("1536x1024");
});
