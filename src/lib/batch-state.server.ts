import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { models, batches, projects, jobs } from "../db/schema";
export async function settleBatch(id: string) {
  const rows = await db.select().from(models).where(eq(models.batchId, id));
  if (
    !rows.length ||
    !rows.every((m) => ["done", "failed", "cancelled"].includes(m.status))
  )
    return;
  const [batch] = await db.select().from(batches).where(eq(batches.id, id));
  const [project] = batch
    ? await db.select().from(projects).where(eq(projects.id, batch.projectId))
    : [];
  const graphics = project?.assetType === "graphic";
  const hasFinalAsset = rows.some(
    (m) =>
      m.status === "done" &&
      m.artifacts &&
      (graphics
        ? Boolean(m.artifacts.image)
        : m.artifacts.stage !== "geometry"),
  );
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(batches)
      .set({
        status: graphics
          ? rows.every((m) => m.status === "done")
            ? "done"
            : "completed_with_errors"
          : hasFinalAsset
            ? "rendering"
            : "completed_with_errors",
      })
      .where(and(eq(batches.id, id), eq(batches.status, "building")))
      .returning();
    if (claimed) {
      const available = await tx
        .select()
        .from(models)
        .where(eq(models.projectId, claimed.projectId));
      if (available.some((m) => m.artifacts?.glb))
        await tx.insert(jobs).values({
          id: crypto.randomUUID(),
          kind: "project-photo",
          targetId: claimed.projectId,
        });
    }
    if (claimed && hasFinalAsset && !graphics)
      await tx
        .insert(jobs)
        .values({ id: crypto.randomUUID(), kind: "demo", targetId: id });
  });
}
