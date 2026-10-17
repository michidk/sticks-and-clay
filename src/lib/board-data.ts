import type { assetEntries, assetVersions, batches, projects } from "@/db/schema";
import type { GenerationInput } from "./api-inputs";

type AssetRow = typeof assetEntries.$inferSelect;
type VersionRow = typeof assetVersions.$inferSelect;
export type BoardAsset = Pick<AssetRow, "id" | "title"> & {
  input: GenerationInput;
  readyAt: string | null;
  inIdea?: boolean;
  references?: string[];
  referenceNotes?: Record<string, string>;
};
export type BoardVersion = Pick<VersionRow, "id" | "batchId" | "name" | "prompt" | "parentModelId" | "branchKind" | "status" | "verdict" | "visualTarget" | "artifacts"> & {
  assetId?: string | null;
  createdAt: string | Date;
  acceptedAt: string | Date | null;
};
export type BoardProject = {
  project: Pick<typeof projects.$inferSelect, "id" | "name" | "assetType" | "designVersion" | "status"> & { archivedAt?: string | Date | null };
  ideas: BoardAsset[];
  assets?: BoardAsset[];
  models: BoardVersion[];
  batches: Pick<typeof batches.$inferSelect, "id" | "status" | "count" | "prompt">[];
  runs: { id: string; modelId: string | null; status: string; role: string; result?: unknown }[];
};
