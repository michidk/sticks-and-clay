import { z } from "zod";

/** What a project produces. Adding a type here makes the compiler list everything that must handle it. */
export const assetTypes = ["model", "graphic", "svg", "pixel"] as const;
export type AssetType = (typeof assetTypes)[number];
export const assetTypeSchema = z.enum(assetTypes);

/** Runs that produce one finished 2D artifact, as opposed to the 3D builder. */
export const flatRoles = ["graphic", "svg", "pixel"] as const;
export const isFlatRole = (role: string): role is (typeof flatRoles)[number] =>
  (flatRoles as readonly string[]).includes(role);

export const assetTypeLabels: Record<AssetType, string> = {
  model: "3D assets",
  graphic: "Graphics",
  svg: "SVG files",
  pixel: "Pixel art",
};
export const assetTypeHints: Record<AssetType, string> = {
  model: "GLB with a Blender source",
  graphic: "PNG images",
  svg: "Editable vector graphics",
  pixel: "PNG drawn cell by cell on a grid",
};
