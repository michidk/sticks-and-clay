import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { jobs } from "../db/schema";

export const jobContext = new AsyncLocalStorage<{
  id: string;
  checkpoint: Record<string, string>;
}>();
export async function checkpoint(key: string, value: string) {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  job.checkpoint[key] = value;
  await db
    .update(jobs)
    .set({ checkpoint: { ...job.checkpoint } })
    .where(eq(jobs.id, job.id));
}
