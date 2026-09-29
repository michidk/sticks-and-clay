import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  doublePrecision,
  index,
} from "drizzle-orm/pg-core";
const created = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
export const projects = pgTable("projects", {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text().notNull(),
  references: jsonb().$type<string[]>().default([]).notNull(),
  design: text().default("").notNull(),
  designVersion: integer().default(0).notNull(),
  status: text().default("queued").notNull(),
  phase: text().default("Waiting for designer").notNull(),
  progress: integer().default(0).notNull(),
  error: text(),
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
  createdAt: created(),
});
export const batches = pgTable("batches", {
  id: text().primaryKey(),
  projectId: text()
    .notNull()
    .references(() => projects.id),
  prompt: text().notNull(),
  count: integer().notNull(),
  judgeIterations: integer().notNull(),
  design: text().notNull(),
  designVersion: integer().notNull(),
  status: text().default("queued").notNull(),
  error: text(),
  preview: jsonb().$type<{ lineup: string; scene: string; blend: string }>(),
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
  status: text().default("queued").notNull(),
  phase: text().default("Queued").notNull(),
  progress: integer().default(0).notNull(),
  iteration: integer().default(0).notNull(),
  verdict: text(),
  feedback: jsonb().$type<unknown>(),
  visualTarget: text("visual_target"),
  artifacts: jsonb().$type<Record<string, unknown>>(),
  error: text(),
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
    usageSource: text().default("pending").notNull(),
    estimatedCost: doublePrecision(),
    rates: jsonb()
      .$type<{
        input: number;
        output: number;
        cached: number;
        source: string;
        longContextThreshold?: number;
        longContextInputMultiplier?: number;
        longContextOutputMultiplier?: number;
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
