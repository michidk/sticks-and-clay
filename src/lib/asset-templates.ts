import type { AssetType } from "./asset-types";
export const assetTemplates = ["custom", "favicon", "logo", "app-icon"] as const;
export type AssetTemplate = (typeof assetTemplates)[number];
export const assetTemplateLabels: Record<AssetTemplate, string> = { custom: "Custom", favicon: "Favicon set", logo: "Logo mark", "app-icon": "App icon" };
export const assetTemplateHints: Record<AssetTemplate, string> = { custom: "Use the brief and approved design as written.", favicon: "A square, recognizable mark that remains clear at 16 and 32 px.", logo: "A distinctive mark that works in one color and on light and dark backgrounds.", "app-icon": "A square icon with a strong silhouette and safe padding for device masks." };
export const assetTemplateGuidance = (template: AssetTemplate, type: AssetType) => template === "custom" ? "" : `\n\nOUTPUT TEMPLATE: ${assetTemplateLabels[template]}\n${assetTemplateHints[template]} ${type === "svg" ? "Use a square 1:1 viewBox." : "Use a square output canvas."} Keep transparent areas transparent; do not add a decorative background. Generate one finished asset, without a contact sheet, mockup, watermark, or alternate options.`;
