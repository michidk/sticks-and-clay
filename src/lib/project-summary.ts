type Asset = {
  id?: string;
  batchId?: string;
  status: string;
  verdict?: string | null;
  parentModelId?: string | null;
  branchKind?: "iterate" | "fork" | null;
  createdAt?: Date | string;
};
type Batch = { id: string; status: string; count: number };

/**
 * Keep prompt iterations in the collection entry they revise. Forks start a
 * new entry, and the newest iteration supplies the entry's current state.
 */
export function collectionAssetGroups<T extends Asset>(assets: T[]) {
  const indexed = assets.map((asset, index) => ({ asset, index }));
  const byId = new Map(
    indexed.flatMap((item) => (item.asset.id ? [[item.asset.id, item]] : [])),
  );
  const groups = new Map<
    string,
    { root: T; representative: T; assets: T[]; latestIndex: number }
  >();

  for (const item of indexed) {
    let root = item;
    const visited = new Set<string>();
    while (
      root.asset.branchKind === "iterate" &&
      root.asset.parentModelId &&
      !visited.has(root.asset.parentModelId)
    ) {
      visited.add(root.asset.parentModelId);
      const parent = byId.get(root.asset.parentModelId);
      if (!parent) break;
      root = parent;
    }

    const key = root.asset.id || `asset:${root.index}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        root: root.asset,
        representative: item.asset,
        assets: [item.asset],
        latestIndex: item.index,
      });
      continue;
    }
    group.assets.push(item.asset);
    const currentTime = new Date(group.representative.createdAt || 0).getTime();
    const candidateTime = new Date(item.asset.createdAt || 0).getTime();
    if (
      candidateTime > currentTime ||
      (candidateTime === currentTime && item.index > group.latestIndex)
    ) {
      group.representative = item.asset;
      group.latestIndex = item.index;
    }
  }

  return [...groups.values()].map(({ latestIndex: _, ...group }) => group);
}

/** Count planned assets only until their model rows exist. */
export function collectionSummary(assets: Asset[], batches: Batch[]) {
  const collectionAssets = collectionAssetGroups(assets).map(
    (group) => group.representative,
  );
  const summary = {
    total: collectionAssets.length,
    queued: 0,
    active: 0,
    completed: 0,
    attention: 0,
  };
  for (const asset of collectionAssets) {
    if (asset.status === "queued") summary.queued++;
    else if (!["done", "failed", "cancelled", "awaiting_approval"].includes(asset.status))
      summary.active++;
    if (asset.status === "done") summary.completed++;
    if (["failed", "awaiting_approval"].includes(asset.status) || asset.verdict === "limit_reached")
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
        status === "review"
          ? "Review design"
          : status === "draft"
            ? "Draft"
            : status.replaceAll("_", " "),
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
