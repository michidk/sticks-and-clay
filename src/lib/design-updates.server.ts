import { and, eq, inArray } from "drizzle-orm";
import type { db } from "../db/client";
import { jobs } from "../db/schema";

export async function assertDesignIdle(
  projectId: string,
  database: Pick<typeof db, "select">,
) {
  const [active] = await database
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.targetId, projectId),
        inArray(jobs.kind, ["design", "design-from-model", "design-update"]),
        inArray(jobs.status, ["queued", "running", "cancelling"]),
      ),
    );
  if (active)
    throw new Error(
      "A design update is in progress. Wait for it to finish before saving or requesting another update.",
    );
}
