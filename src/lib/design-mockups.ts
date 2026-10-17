import { z } from "zod";

export const mockupInput = z.object({
  version: z.number().int().nonnegative(),
  count: z.number().int().min(1).max(4).default(3),
  hint: z.string().trim().max(12000).default(""),
  /** Revise this saved mockup instead of starting from the design alone. */
  baseId: z.string().max(40).optional(),
});

export const mockupSnapshot = z.object({
  version: z.number().int().nonnegative(),
  references: z.array(z.string()).max(7),
  prompts: z.array(z.string()).min(1).max(4),
  hint: z.string().optional(),
  baseId: z.string().optional(),
});

export const mockupImage = z.object({ key: z.string(), runId: z.string() });

export const mockupNoteInput = z.object({ note: z.string().trim().max(2000).default("") });

/** Accepted mockups frozen into a batch, newest first and capped so references stay few. */
export const MAX_ACCEPTED_MOCKUPS = 4;

export type DesignMockups = {
  id: string;
  status: string;
  error: string | null;
  createdAt: string;
  version: number;
  count: number;
  hint: string;
  baseId: string | null;
  images: z.infer<typeof mockupImage>[];
};

export type MockupItem = {
  id: string;
  key: string;
  source: "generated" | "uploaded";
  designVersion: number;
  parentId: string | null;
  jobId: string | null;
  note: string;
  acceptedAt: string | null;
  createdAt: string;
};
