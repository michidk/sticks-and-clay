export type PendingBatch = {
  id: string;
  status: string;
  count: number;
  prompt: string;
  error?: string;
};
export function pendingCollectionItems(
  batches: PendingBatch[],
  models: { batchId: string }[],
) {
  return batches
    .filter((batch) => ["queued", "planning", "failed"].includes(batch.status))
    .flatMap((batch) => {
      const created = models.filter(
        (model) => model.batchId === batch.id,
      ).length;
      const remaining = Math.max(0, batch.count - created);
      return Array.from(
        { length: remaining || (batch.status === "failed" ? 1 : 0) },
        (_, index) => ({
          batch,
          index: created + index,
          placeholder: remaining > 0,
          key: `${batch.id}:${created + index}`,
        }),
      );
    });
}
