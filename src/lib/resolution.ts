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

export function imageCanvas(resolution: Resolution | null | undefined, fallback: "1024x1024" | "1024x1536" | "1536x1024") {
  if (!resolution) return fallback;
  const ratio = resolution.width / resolution.height;
  return ratio > 1.25 ? "1536x1024" : ratio < 0.8 ? "1024x1536" : "1024x1024";
}
