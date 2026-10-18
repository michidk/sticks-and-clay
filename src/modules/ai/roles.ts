import { z } from "zod";
import { pixelGridSchema } from "../../lib/pixel";
import { cadBuildResult, cadSpecResult } from "../../lib/cad";
import type { AssetType } from "../../lib/asset-types";
import {
  materialPlanResult,
  materialBuildResult,
  materialReviewResult,
} from "../../lib/materials";
import {
  projectNameResult,
  ideaTitleResult,
  briefResult,
  designResult,
  planResult,
  buildResult,
  judgeResult,
} from "../../lib/contracts";

function role<S extends z.ZodType>(
  engine: "tanstack" | "eve",
  prompt: string,
  schema: S,
  model = "gpt-6-sol",
  effort: "low" | "medium" | "high" = "medium",
  references: readonly string[] = [],
) {
  return {
    engine,
    model,
    effort,
    prompt,
    inputTemplate: `${prompt}-input`,
    references,
    schema,
  } as const;
}

/** Authored instructions stay in /prompts; execution policy and contracts live here. */
export const roles = {
  cad: role("tanstack", "cad/builder", cadBuildResult, "gpt-6-astra", "high", ["references/cad-construction"]),
  "cad-spec": role("tanstack", "cad/spec", cadSpecResult, "gpt-6-sol", "high"),
  "cad-judge": { ...role("tanstack", "cad/judge", judgeResult, "gpt-6-astra", "high"), inputTemplate: "graphics/graphic-judge-input" },
  "cad-designer": role("tanstack", "cad/designer", designResult),
  "cad-design-update": { ...role("tanstack", "cad/designer", designResult), inputTemplate: "design/design-update-input" },
  "cad-planner": { ...role("tanstack", "cad/planner", planResult), inputTemplate: "planning/planner-input" },
  svg: role(
    "tanstack",
    "svg/svg",
    // Plan first: the model commits to canvas, palette and construction before drawing.
    z.object({ plan: z.string().max(4000).optional(), svg: z.string().min(1).max(500_000) }),
    "gpt-6-sol",
    "high",
  ),
  "svg-judge": {
    ...role("tanstack", "svg/svg-judge", judgeResult, "gpt-6-astra", "high"),
    inputTemplate: "graphics/graphic-judge-input",
  },
  "graphic-judge": role("tanstack", "graphics/graphic-judge", judgeResult, "gpt-6-sol", "high"),
  "svg-designer": role("tanstack", "design/svg-designer", designResult),
  "svg-design-update": { ...role("tanstack", "design/svg-designer", designResult), inputTemplate: "design/design-update-input" },
  "svg-planner": { ...role("tanstack", "planning/graphic-planner", planResult), inputTemplate: "planning/graphic-planner-input" },
  // Pixel art is drawn on a grid by the text model, like SVG, and rendered exactly by the app.
  pixel: role("tanstack", "pixel/pixel", pixelGridSchema, "gpt-6-sol", "high"),
  "pixel-judge": {
    ...role("tanstack", "pixel/pixel-judge", judgeResult, "gpt-6-sol", "high"),
    inputTemplate: "graphics/graphic-judge-input",
  },
  "pixel-designer": role("tanstack", "design/pixel-designer", designResult),
  "pixel-design-update": { ...role("tanstack", "design/pixel-designer", designResult), inputTemplate: "design/design-update-input" },
  "pixel-planner": { ...role("tanstack", "planning/graphic-planner", planResult), inputTemplate: "planning/graphic-planner-input" },
  "material-planner": role("tanstack", "materials/material-planner", materialPlanResult),
  "material-builder": role(
    "tanstack",
    "materials/material-builder",
    materialBuildResult,
    "gpt-6-sol",
    "high",
    ["references/material-construction"],
  ),
  "material-judge": role(
    "tanstack",
    "materials/material-judge",
    materialReviewResult,
    "gpt-6-sol",
    "high",
  ),
  "project-name": role("tanstack", "project/project-name", projectNameResult),
  "idea-title": role("tanstack", "project/idea-title", ideaTitleResult, "gpt-6-sol", "low"),
  "project-brief": role("tanstack", "project/project-brief", briefResult),
  "model-brief": role("tanstack", "planning/model-brief", briefResult),
  "graphic-brief": role("tanstack", "planning/graphic-brief", briefResult),
  designer: role("tanstack", "design/designer", designResult),
  "design-update": {
    ...role("tanstack", "design/designer", designResult),
    inputTemplate: "design/design-update-input",
  },
  "graphic-design-update": {
    ...role("tanstack", "design/graphic-designer", designResult),
    inputTemplate: "design/design-update-input",
  },
  "design-from-model": {
    ...role("tanstack", "design/designer", designResult),
    inputTemplate: "design/design-from-model-input",
  },
  "graphic-designer": role("tanstack", "design/graphic-designer", designResult),
  planner: role("eve", "planning/planner", planResult),
  "graphic-planner": role("eve", "planning/graphic-planner", planResult),
  builder: role("eve", "models/builder", buildResult, "gpt-6-astra", "high", [
    "references/modeling-method",
    "references/hard-surface",
    "references/organic-and-trees",
    "references/uv-and-materials",
    "references/assetkit",
    "references/game-interfaces",
  ]),
  photographer: role(
    "eve",
    "models/photographer",
    buildResult,
    "gpt-6-astra",
    "medium",
  ),
  judge: role("eve", "models/judge", judgeResult, "gpt-6-astra", "high", [
    "references/review-method",
  ]),
} as const;
export type Role = keyof typeof roles;
/** Which role handles each stage for each asset type; a new type must name all three. */
export const assetRoles = {
  cad: { designer: "cad-designer", update: "cad-design-update", planner: "cad-planner" },
  model: { designer: "designer", update: "design-update", planner: "planner" },
  graphic: { designer: "graphic-designer", update: "graphic-design-update", planner: "graphic-planner" },
  svg: { designer: "svg-designer", update: "svg-design-update", planner: "svg-planner" },
  pixel: { designer: "pixel-designer", update: "pixel-design-update", planner: "pixel-planner" },
} as const satisfies Record<AssetType, { designer: Role; update: Role; planner: Role }>;
export const immediateRoles: Role[] = ["project-name", "idea-title", "project-brief", "model-brief", "graphic-brief"];
export type RoleResult<R extends Role> = z.infer<(typeof roles)[R]["schema"]>;
export type RunInput<R extends Role = Role> = {
  role: R;
  projectId: string;
  batchId?: string;
  modelId?: string;
  iteration?: number;
  /** Stable occurrence identity for repeated roles in new pipelines. */
  stepId?: string;
  input: string;
  images?: string[];
  construction?: {
    request: string;
    stage: string;
    outputTarget?: "model" | "sprite";
  };
  onActivity?: (tool: string) => Promise<void>;
};

export function executionPolicy(role: Role, legacyDesigner = false) {
  const engine =
    role === "designer" && legacyDesigner ? "eve" : roles[role].engine;
  return { engine, resumable: engine === "eve" } as const;
}

/** Image roles are one-shot requests, not resumable Eve sessions. */
export const imageRoles = {
  "design-mockup": {
    engine: "imagegen",
    model: "gpt-image-2",
    quality: "medium",
    prompt: "design/design-mockup",
    inputTemplate: "design/design-mockup",
  },
  graphic: {
    engine: "imagegen",
    model: "gpt-image-2",
    quality: "high",
    prompt: "graphics/graphic",
    inputTemplate: "graphics/graphic",
  },
  "visual-target": {
    engine: "imagegen",
    model: "gpt-image-2",
    quality: "medium",
    prompt: "models/visual-target",
    inputTemplate: "models/visual-target",
  },
  texture: {
    engine: "imagegen",
    model: "gpt-image-2",
    quality: "medium",
    prompt: "models/builder",
    inputTemplate: "models/builder-input",
  },
} as const;
