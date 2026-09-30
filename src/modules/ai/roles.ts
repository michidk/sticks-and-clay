import { z } from "zod";
import {
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
  "project-brief": role("tanstack", "project-brief", briefResult),
  "model-brief": role("tanstack", "model-brief", briefResult),
  designer: role("tanstack", "designer", designResult),
  planner: role("eve", "planner", planResult),
  builder: role("eve", "builder", buildResult, "gpt-6-astra", "high", [
    "references/modeling-method",
    "references/hard-surface",
    "references/organic-and-trees",
    "references/uv-and-materials",
  ]),
  photographer: role(
    "eve",
    "photographer",
    buildResult,
    "gpt-6-astra",
    "medium",
  ),
  judge: role("eve", "judge", judgeResult, "gpt-6-astra", "high", [
    "references/review-method",
  ]),
} as const;
export type Role = keyof typeof roles;
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
  onActivity?: (tool: string) => Promise<void>;
};

export function executionPolicy(role: Role, legacyDesigner = false) {
  const engine =
    role === "designer" && legacyDesigner ? "eve" : roles[role].engine;
  return { engine, resumable: engine === "eve" } as const;
}

/** Image roles are one-shot requests, not resumable Eve sessions. */
export const imageRoles = {
  "visual-target": {
    engine: "imagegen",
    model: "gpt-image-2",
    quality: "medium",
    prompt: "visual-target",
    inputTemplate: "visual-target",
  },
  texture: {
    engine: "imagegen",
    model: "gpt-image-2",
    quality: "medium",
    prompt: "builder",
    inputTemplate: "builder-input",
  },
} as const;
