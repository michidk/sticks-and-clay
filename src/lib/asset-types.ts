import { z } from "zod";

/** What a project produces. Adding a type here makes the compiler list everything that must handle it. */
export const assetTypes = ["model", "graphic", "svg", "pixel", "cad"] as const;
export type AssetType = (typeof assetTypes)[number];
export const assetTypeSchema = z.enum(assetTypes);

/** Runs using the shared candidate/review loop rather than the multi-pass Blender builder. */
export const flatRoles = ["graphic", "svg", "pixel", "cad"] as const;
export const isFlatRole = (role: string): role is (typeof flatRoles)[number] =>
  (flatRoles as readonly string[]).includes(role);

export const assetTypeLabels: Record<AssetType, string> = {
  cad: "CAD parts",
  model: "3D assets",
  graphic: "Graphics",
  svg: "SVG files",
  pixel: "Pixel art",
};
export const assetTypeHints: Record<AssetType, string> = {
  cad: "CadQuery Python, STEP and STL with a 3D preview",
  model: "GLB with a Blender source",
  graphic: "PNG images",
  svg: "Icons, logos and vector illustrations",
  pixel: "PNG drawn cell by cell on a grid",
};
