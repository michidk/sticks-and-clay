import { z } from "zod";

export const buildKind = z.enum(["model", "material", "sprite", "photography"]);
export const failureKind = z.enum([
  "script",
  "validation",
  "dependency",
  "timeout",
  "cancelled",
  "runner",
]);
export const artifactSchema = z.object({
  id: z.string(),
  role: z.string(),
  path: z
    .string()
    .refine(
      (p) =>
        !p.startsWith("/") &&
        !p.includes("\\") &&
        !p.split("/").includes("..") &&
        !p.includes(":"),
    ),
  label: z.string(),
  mime: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export const receiptSchema = z.object({
  version: z.literal(1),
  buildId: z.string(),
  kind: buildKind,
  mode: z.enum(["quick", "final"]),
  status: z.enum(["done", "failed"]),
  inputHash: z.string(),
  inputs: z.record(z.string(), z.string()).default({}),
  artifacts: z.array(artifactSchema),
  checks: z
    .array(
      z.object({
        id: z.string(),
        state: z.enum(["pass", "warn", "fail", "unknown"]),
        message: z.string(),
      }),
    )
    .default([]),
  failure: z.object({ kind: failureKind, message: z.string() }).optional(),
  timings: z.record(z.string(), z.number()).default({}),
  toolchain: z.record(z.string(), z.string()).default({}),
});
export type BuildReceipt = z.infer<typeof receiptSchema>;
export type BuildArtifact = z.infer<typeof artifactSchema>;
