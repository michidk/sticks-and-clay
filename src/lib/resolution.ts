import type { AssetType } from "./asset-types";
import type { Resolution } from "./contracts";

export function validateResolution(type: AssetType, resolution: Resolution | null | undefined) {
  if (!resolution) return;
  if (type !== "pixel" && type !== "graphic") throw new Error("Resolution applies only to pixel art and graphics");
  if (type === "pixel" && (resolution.width > 128 || resolution.height > 128))
    throw new Error("Pixel art resolution must be between 4 and 128 pixels per dimension");
}

export function resolutionLabel(resolution: Resolution) {
  return `${resolution.width}×${resolution.height}`;
}

export function imageCanvas(resolution: Resolution | null | undefined, fallback: `${number}x${number}`): `${number}x${number}` {
  return resolution ? `${resolution.width}x${resolution.height}` : fallback;
}

export class UnsupportedResolution extends Error {}

export function dimensionError(actual: Resolution, expected: Resolution | null | undefined) {
  return expected && (actual.width !== expected.width || actual.height !== expected.height)
    ? `Output dimension error: requested ${resolutionLabel(expected)} pixels, received ${resolutionLabel(actual)}. The requested resolution has not been changed.`
    : undefined;
}
