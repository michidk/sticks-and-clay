import { z } from "zod";

export const mockupInput = z.object({
  version: z.number().int().nonnegative(),
  count: z.number().int().min(1).max(4).default(3),
  hint: z.string().trim().max(12000).default(""),
});

export const mockupSnapshot = z.object({
  version: z.number().int().nonnegative(),
  references: z.array(z.string()).max(6),
  prompts: z.array(z.string()).min(1).max(4),
});

export const mockupImage = z.object({ key: z.string(), runId: z.string() });

export type DesignMockups = {
  id: string;
  status: string;
  error: string | null;
  createdAt: string;
  version: number;
  count: number;
  images: z.infer<typeof mockupImage>[];
};
