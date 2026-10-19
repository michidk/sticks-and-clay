import { z } from "zod";
import { effortSchema, imageSizeSchema, resolutionSchema } from "./contracts";
import { materialSchema } from "./materials";
import { spriteOptionsSchema } from "./sprites";
import { objectReferenceSchema } from "./object-reference";
import { startingPointSchema } from "./starting-point";

const uuid = z.string().uuid();

export const assetBriefInput = z.object({
  count: z.number().int().min(1).max(20),
  hint: z.string().max(12000).default(""),
});

export const designInput = z.object({
  design: z.string().min(1).max(50000),
  version: z.number().int().nonnegative(),
  approve: z.boolean().default(false),
});

export const generationInput = z.object({
  resolution: resolutionSchema.nullable().optional(),
  startingPoint: startingPointSchema.optional(),
  visualTargetMode: z.enum(["review", "skip"]).optional(),
  prompt: z.string().trim().max(12000).default(""),
  count: z.number().int().min(1).max(20),
  judgeIterations: z.number().int().min(0).max(5),
  spriteTarget: spriteOptionsSchema.optional(),
  imageSize: imageSizeSchema.default("1024x1024"),
  parts: z.array(z.object({ name: z.string().trim().min(1).max(80), brief: z.string().trim().min(1).max(2000) })).min(1).max(8).refine((parts) => new Set(parts.map((part) => part.name.toLowerCase())).size === parts.length, "Part names must be unique").optional(),
});
export type GenerationInput = z.infer<typeof generationInput>;

/** Saved ideas need a brief; a blank title is written by AI from it. Started batches keep the looser contract. */
export const ideaInput = generationInput.extend({
  count: z.literal(1).default(1),
  prompt: z.string().trim().min(1, "Write a brief for this idea").max(12000),
  title: z.string().trim().max(100).default(""),
});
export type IdeaInput = z.infer<typeof ideaInput>;
export const ideaUpdateInput = ideaInput.extend({ imageSize: imageSizeSchema.optional() });
export type IdeaUpdateInput = z.infer<typeof ideaUpdateInput>;

export const branchInput = z.object({
  kind: z.enum(["iterate", "fork"]),
  useCurrentStyle: z.boolean().default(false),
  objectReference: objectReferenceSchema.optional(),
  sourceRunId: uuid,
  prompt: z.string().trim().min(3).max(12000),
  name: z.string().trim().min(1).max(100).optional(),
  judgeIterations: z.number().int().min(0).max(5),
});

export const exportInput = z.object({
  modelIds: z.array(uuid).min(1).max(500).optional(),
  acceptedOnly: z.boolean().default(false),
});
export type ExportInput = z.infer<typeof exportInput>;
export const readyInput = z.object({ ready: z.boolean() });
export const acceptInput = z.object({ accepted: z.boolean() });

export const designPromptInput = z.object({
  prompt: z.string().trim().min(3).max(12000),
  version: z.number().int().nonnegative(),
});

export const designUpdateInput = z.object({
  sourceRunId: uuid,
  view: z.number().int().min(0).max(12),
  replaceReference: z.string().optional(),
});

export const agentInput = z.object({
  id: z.string().min(1),
  engine: z.enum(["eve", "tanstack", "imagegen"]),
  model: z.string().trim().min(1).max(100),
  effort: effortSchema,
});

export type AgentInput = z.infer<typeof agentInput>;

export const materialInput =z.object({
  parameters: materialSchema,
  prompt: z.string().trim().max(12000).default(""),
  reviewRounds: z.number().int().min(0).max(5).default(2),
  parentId: uuid.optional(),
  exampleIds: z.array(uuid).max(3).default([]),
});

export const presentationInput = z.object({
  sourceRunId: uuid,
  sprites: z.boolean().default(false),
  spriteOptions: spriteOptionsSchema.optional(),
});

export const materialAssignmentInput = z.object({
  materialVersionId: uuid,
  slot: z.string().min(1).max(256),
  repeat: z.number().min(1).max(8),
});

export const visualTargetDecisionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), target: z.string().min(1) }),
  z.object({ action: z.literal("revise"), target: z.string().min(1), prompt: z.string().trim().min(3).max(12000) }),
]);
