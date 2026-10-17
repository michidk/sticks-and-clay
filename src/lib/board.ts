import { collectionAssetGroups } from "./project-summary";

export const boardStages = ["idea", "ready", "progress", "review", "done"] as const;
export type BoardStage = (typeof boardStages)[number];
export const boardStageTitles: Record<BoardStage, string> = {
  idea: "Ideas", ready: "Ready", progress: "In progress", review: "Review", done: "Done",
};

type Idea = { id: string; readyAt?: Date | string | null };
type Asset = {
  id: string;
  batchId: string;
  status: string;
  acceptedAt?: Date | string | null;
  parentModelId?: string | null;
  branchKind?: "iterate" | "fork" | null;
  createdAt?: Date | string;
};
type Batch = { id: string; status: string; count: number };

/** Where an asset is in its life: the newest iteration of each collection entry decides. */
export function assetStage(asset: Pick<Asset, "status" | "acceptedAt">): BoardStage {
  if (asset.status !== "done") return "progress";
  return asset.acceptedAt ? "done" : "review";
}

/**
 * Ideas and Ready hold unstarted ideas; started work appears per asset. Batches
 * that still owe assets show as in-progress placeholders until their rows exist.
 */
export function boardColumns<I extends Idea, A extends Asset, B extends Batch>(
  ideas: I[], assets: A[], batches: B[],
) {
  const columns = {
    idea: [] as { kind: "idea"; idea: I }[],
    ready: [] as { kind: "idea"; idea: I }[],
    progress: [] as ({ kind: "asset"; asset: A; attempts: number } | { kind: "pending"; batch: B; owed: number })[],
    review: [] as { kind: "asset"; asset: A; attempts: number }[],
    done: [] as { kind: "asset"; asset: A; attempts: number }[],
  };
  for (const idea of ideas) columns[idea.readyAt ? "ready" : "idea"].push({ kind: "idea", idea });
  for (const batch of batches) {
    if (!["queued", "planning", "failed"].includes(batch.status)) continue;
    const owed = batch.count - assets.filter((asset) => asset.batchId === batch.id).length;
    if (owed > 0) columns.progress.push({ kind: "pending", batch, owed });
  }
  for (const group of collectionAssetGroups(assets)) {
    const card = { kind: "asset" as const, asset: group.representative, attempts: group.assets.length };
    columns[assetStage(group.representative) as "progress" | "review" | "done"].push(card);
  }
  return columns;
}

/** The latest saved build or graphic an iteration can start from (runs are newest first). */
export function latestSourceRun(runs: { id: string; modelId?: string | null; status: string; role: string; result?: any }[], modelId: string) {
  return runs.find((run) => run.modelId === modelId && run.status === "done" &&
    (["graphic", "svg"].includes(run.role) || (run.role === "builder" && run.result?.artifacts?.blend)))?.id;
}
