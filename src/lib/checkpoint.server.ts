import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { jobs } from "../db/schema";
import type { z } from "zod";

export const jobContext = new AsyncLocalStorage<{
  id: string;
  checkpoint: Record<string, string>;
}>();
export async function checkpoint(key: string, value: string) {
  return checkpointMany({ [key]: value });
}
export function readCheckpoint<T>(
  key: string,
  schema: z.ZodType<T>,
): T | undefined {
  const value = jobContext.getStore()?.checkpoint[key];
  return value === undefined ? undefined : schema.parse(JSON.parse(value));
}
const updates = new Map<string, Promise<void>>();
export async function checkpointMany(values: Record<string, string>) {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  const pending = (updates.get(job.id) || Promise.resolve()).then(async () => {
    const next = { ...job.checkpoint, ...values };
    await db.update(jobs).set({ checkpoint: next }).where(eq(jobs.id, job.id));
    Object.assign(job.checkpoint, values);
  });
  updates.set(job.id, pending);
  try {
    await pending;
  } finally {
    if (updates.get(job.id) === pending) updates.delete(job.id);
  }
}
