export type PendingBatch = {
  id: string;
  status: string;
  count: number;
  prompt: string;
  error?: string;
};
/** One placeholder card per model the batch still owes. */
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
      return Array.from(
        { length: Math.max(0, batch.count - created) },
        (_, index) => ({
          batch,
          index: created + index,
          key: `${batch.id}:${created + index}`,
        }),
      );
    });
}
/** A batch that failed after its models existed, i.e. the collection render step. */
export function failedBatchFor(
  batches: PendingBatch[],
  models: { batchId?: string }[],
) {
  return batches.find(
    (batch) =>
      batch.status === "failed" &&
      models.some((model) => model.batchId === batch.id),
  );
}
