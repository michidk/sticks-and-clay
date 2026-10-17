import { collectionAssetGroups } from "./project-summary";

export const boardStages = ["idea", "ready", "progress", "review", "done"] as const;
export type BoardStage = (typeof boardStages)[number];
export const boardStageTitles: Record<BoardStage, string> = {
  idea: "Ideas", ready: "Ready", progress: "In progress", review: "Review", done: "Done",
};

type Idea = { id: string; readyAt?: Date | string | null };
type Asset = {
  id: string;
  assetId?: string | null;
  batchId: string;
  status: string;
  acceptedAt?: Date | string | null;
  parentModelId?: string | null;
  branchKind?: "iterate" | "fork" | null;
  createdAt?: Date | string;
};
type Batch = { id: string; status: string; count: number };
/** An asset card is its newest attempt; the root is the entry's first attempt, which holds its origin. */
type AssetCard<A> = { kind: "asset"; asset: A; root: A; attempts: number };

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
    progress: [] as (AssetCard<A> | { kind: "pending"; batch: B; owed: number })[],
    review: [] as AssetCard<A>[],
    done: [] as AssetCard<A>[],
  };
  for (const idea of ideas) columns[idea.readyAt ? "ready" : "idea"].push({ kind: "idea", idea });
  for (const batch of batches) {
    if (!["queued", "planning", "failed"].includes(batch.status)) continue;
    const owed = batch.count - assets.filter((asset) => asset.batchId === batch.id).length;
    if (owed > 0) columns.progress.push({ kind: "pending", batch, owed });
  }
  for (const group of collectionAssetGroups(assets)) {
    const card = { kind: "asset" as const, asset: group.representative, root: group.root, attempts: group.assets.length };
    columns[assetStage(group.representative) as "progress" | "review" | "done"].push(card);
  }
  return columns;
}

/** The latest saved build or graphic an iteration can start from, newest first. */
export function latestSourceRun(runs: { id: string; modelId?: string | null; status: string; role: string; result?: unknown }[], modelId: string) {
  return runs.find((run) => {
    if (run.modelId !== modelId || run.status !== "done") return false;
    if (["graphic", "svg"].includes(run.role)) return true;
    if (run.role !== "builder" || !run.result || typeof run.result !== "object" || !("artifacts" in run.result)) return false;
    const artifacts = run.result.artifacts;
    return artifacts && typeof artifacts === "object" && "blend" in artifacts && typeof artifacts.blend === "string";
  })?.id;
}
