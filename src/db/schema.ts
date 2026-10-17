import type { ObjectReference } from "../lib/object-reference";
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  doublePrecision,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import type { Workshop, WorkshopSnapshot } from "../lib/workshop";
import type { SpriteOptions } from "../lib/sprites";
import type { GenerationInput } from "../lib/api-inputs";
const created = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const materialVersions = pgTable("material_versions", {
  id: text().primaryKey(),
  materialId: text().notNull(),
  parentId: text(),
  projectId: text()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  jobId: text().notNull(),
  outcome: text().notNull().default("pending"),
  snapshot: jsonb().$type<Record<string, unknown>>().notNull(),
  result: jsonb().$type<Record<string, unknown>>(),
  createdAt: created(),
});
export const projects = pgTable("projects", {
  id: text().primaryKey(),
  name: text().notNull(),
  assetType: text("asset_type")
    .$type<"model" | "graphic" | "svg">()
    .default("model")
    .notNull(),
  description: text().notNull(),
  references: jsonb().$type<string[]>().default([]).notNull(),
  /** The owner's context for individual references, keyed by reference key. */
  referenceNotes: jsonb("reference_notes").$type<Record<string, string>>().default({}).notNull(),
  design: text().default("").notNull(),
  designVersion: integer().default(0).notNull(),
  workshop: jsonb().$type<Workshop>(),
  status: text().default("queued").notNull(),
  phase: text().default("Waiting for designer").notNull(),
  progress: integer().default(0).notNull(),
  error: text(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: created(),
});
export const revisions = pgTable("design_revisions", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id),
  version: integer().notNull(),
  content: text().notNull(),
  author: text().notNull(),
  approved: boolean().default(false).notNull(),
  createdAt: created(),
});
/** Concept images for a project: generated, revised from another mockup, or uploaded.
 * Accepted ones (with their note) are frozen into each new batch as visual direction. */
export const mockups = pgTable("mockups", {
  id: text().primaryKey(),
  projectId: text().notNull().references(() => projects.id, { onDelete: "cascade" }),
  key: text().notNull(),
  source: text().$type<"generated" | "uploaded">().notNull(),
  designVersion: integer().notNull(),
  parentId: text(),
  jobId: text(),
  runId: text(),
  note: text().default("").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: created(),
}, (table) => [index("mockups_project_id_idx").on(table.projectId)]);
export const modelIdeas = pgTable("model_ideas", {
  id: text().primaryKey(),
  projectId: text().notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** Written by the owner or by AI from the brief; null only on ideas saved before titles existed. */
  title: text(),
  input: jsonb().$type<GenerationInput>().notNull(),
  batchId: text().references(() => batches.id),
  /** The owner's marker that the brief is final; starting stays a separate, paid action. */
  readyAt: timestamp("ready_at", { withTimezone: true }),
  createdAt: created(),
}, (table) => [index("model_ideas_project_id_idx").on(table.projectId)]);
export const batches = pgTable("batches", {
  visualTargetMode: text("visual_target_mode").$type<"auto" | "review" | "skip">().default("auto").notNull(),
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id),
  prompt: text().notNull(),
  count: integer().notNull(),
  judgeIterations: integer().notNull(),
  spriteTarget: jsonb().$type<SpriteOptions>(),
  imageSize: text("image_size")
    .$type<"1024x1024" | "1024x1536" | "1536x1024">()
    .default("1024x1024")
    .notNull(),
  design: text().notNull(),
  designVersion: integer().notNull(),
  workshop: jsonb().$type<WorkshopSnapshot>(),
  status: text().default("queued").notNull(),
  error: text(),
  preview: jsonb().$type<{ lineup: string; scene: string; blend: string } | { sheet: string }>(),
  createdAt: created(),
});
export const models = pgTable("models", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id),
  batchId: text()
    .notNull()
    .references(() => batches.id),
  name: text().notNull(),
  prompt: text().notNull(),
  parentModelId: text("parent_model_id"),
  sourceRunId: text("source_run_id"),
  changePrompt: text("change_prompt"),
  objectReference: jsonb("object_reference").$type<ObjectReference>(),
  branchKind: text("branch_kind").$type<"iterate" | "fork">(),
  status: text().default("queued").notNull(),
  phase: text().default("Queued").notNull(),
  progress: integer().default(0).notNull(),
  iteration: integer().default(0).notNull(),
  verdict: text(),
  feedback: jsonb().$type<unknown>(),
  visualTarget: text("visual_target"),
  artifacts: jsonb().$type<Record<string, unknown>>(),
  error: text(),
  /** The owner accepted this finished attempt; separate from the AI judge's verdict. */
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: created(),
});
export const runs = pgTable(
  "agent_runs",
  {
    id: text().primaryKey(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    batchId: text(),
    modelId: text(),
    role: text().notNull(),
    engine: text()
      .$type<"eve" | "tanstack" | "imagegen">()
      .default("eve")
      .notNull(),
    stepId: text("step_id"),
    iteration: integer().default(0).notNull(),
    status: text().default("running").notNull(),
    sessionId: text(),
    model: text().notNull(),
    effort: text(),
    promptVersion: text().notNull(),
    systemPrompt: text().notNull(),
    input: text().notNull(),
    images: jsonb().$type<string[]>().default([]).notNull(),
    output: text(),
    result: jsonb().$type<unknown>(),
    error: text(),
    inputTokens: integer().default(0).notNull(),
    outputTokens: integer().default(0).notNull(),
    cachedTokens: integer().default(0).notNull(),
    cacheWriteTokens: integer("cache_write_tokens").default(0).notNull(),
    usageSource: text().default("pending").notNull(),
    estimatedCost: doublePrecision(),
    rates: jsonb()
      .$type<{
        input: number;
        output: number;
        cached: number;
        cacheWrite?: number;
        source: string;
        unavailable?: boolean;
        longContextThreshold?: number;
        longContextInputMultiplier?: number;
        longContextOutputMultiplier?: number;
        textInput?: number;
        cachedTextInput?: number;
        imageInput?: number;
        cachedImageInput?: number;
        imageOutput?: number;
      }>()
      .notNull(),
    createdAt: created(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("runs_project_idx").on(t.projectId)],
);
export const events = pgTable(
  "agent_events",
  {
    id: text().primaryKey(),
    runId: text()
      .notNull()
      .references(() => runs.id),
    type: text().notNull(),
    payload: jsonb().$type<unknown>().notNull(),
    createdAt: created(),
  },
  (t) => [index("events_run_idx").on(t.runId)],
);
export const jobs = pgTable("jobs", {
  checkpoint: jsonb().$type<Record<string, string>>().default({}).notNull(),
  id: text().primaryKey(),
  kind: text().notNull(),
  targetId: text().notNull(),
  status: text().default("queued").notNull(),
  error: text(),
  createdAt: created(),
  startedAt: timestamp({ withTimezone: true }),
  finishedAt: timestamp({ withTimezone: true }),
});

export * from "./mcp-schema";
