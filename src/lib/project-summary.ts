type Asset = { batchId: string; status: string; verdict?: string | null };
type Batch = { id: string; status: string; count: number };

/** Count planned assets only until their model rows exist. */
export function collectionSummary(assets: Asset[], batches: Batch[]) {
  const summary = {
    total: assets.length,
    queued: 0,
    active: 0,
    completed: 0,
    attention: 0,
  };
  for (const asset of assets) {
    if (asset.status === "queued") summary.queued++;
    else if (!["done", "failed", "cancelled"].includes(asset.status))
      summary.active++;
    if (asset.status === "done") summary.completed++;
    if (asset.status === "failed" || asset.verdict === "limit_reached")
      summary.attention++;
  }
  for (const batch of batches) {
    if (!["queued", "planning", "failed"].includes(batch.status)) continue;
    const remaining = Math.max(
      0,
      batch.count - assets.filter((asset) => asset.batchId === batch.id).length,
    );
    summary.total += remaining;
    if (batch.status === "failed") summary.attention += remaining || 1;
    else if (batch.status === "queued") summary.queued += remaining;
    else summary.active += remaining;
  }
  return summary;
}

export function projectState(
  status: string,
  collection: ReturnType<typeof collectionSummary>,
) {
  if (status !== "ready")
    return {
      label:
        status === "review" ? "Review design" : status.replaceAll("_", " "),
      tone: status,
    };
  if (collection.active)
    return { label: `${collection.active} in progress`, tone: "running" };
  if (collection.queued)
    return { label: `${collection.queued} queued`, tone: "queued" };
  if (collection.attention)
    return { label: `${collection.attention} need attention`, tone: "warning" };
  if (collection.completed)
    return { label: `${collection.completed} completed`, tone: "done" };
  return { label: "Ready to generate", tone: "ready" };
}
