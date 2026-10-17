import type { ObjectReference } from "@/lib/object-reference";
import type { AssetType } from "@/lib/asset-types";
import type { AnalysisReport } from "@/modules/model-analysis/report";
import type { PipelineRun } from "./pipeline";
export type Review = {
  score: number;
  passed: boolean;
  summary: string;
  improvements: {
    priority: string;
    view?: string;
    issue: string;
    action: string;
  }[];
};
export type Artifacts = {
  script?: string;
  buildManifest?: string;
  sourceBundle?: string;
  lods?: { key: string; ratio: number }[];
  sprites?: { image: string; layout: string };
  handover?: {
    inputBytes: number;
    outputBytes: number;
    outputSha256: string;
    manifest?: string;
    cleanup?: { status: string; reason?: string; steps?: string[] };
  };
  glb: string;
  blend: string;
  renders: string[];
  stage?: string;
  visualTarget?: string;
  textures?: { key: string; name: string; kind: string }[];
  metrics: {
    triangles?: number;
    dimensions?: number[];
    readiness?: {
      status: string;
      findings: { code: string; object: string; message: string }[];
    };
    styleReview?: { warnings: string[] };
  };
};
export type Model = {
  id: string;
  assetId?: string | null;
  batchId?: string;
  name: string;
  prompt: string;
  parentModelId?: string | null;
  sourceRunId?: string | null;
  changePrompt?: string | null;
  objectReference?: ObjectReference | null;
  branchKind?: "iterate" | "fork" | null;
  status: string;
  phase: string;
  progress: number;
  verdict?: string;
  error?: string;
  visualTarget?: string;
  artifacts?: Artifacts;
  feedback?: Review;
};
export type Build = {
  id: string;
  modelId: string;
  iteration: number;
  status: string;
  createdAt: string;
  artifacts?: Artifacts;
  summary?: string;
  error?: string;
  judges: {
    id: string;
    status: string;
    result?: Review;
    analysis?: AnalysisReport;
    error?: string;
  }[];
};
export type Workspace = {
  project: {
    id: string;
    name: string;
    designVersion: number;
    assetType?: AssetType;
    archivedAt?: string | null;
    status: string;
    references: string[];
  };
  assets?: { id: string; title?: string | null; references: string[]; referenceNotes: Record<string, string> }[];
  assetVersions: Model[];
  batches: { id: string; judgeIterations: number }[];
  versions: Build[];
  activeJobs?: { id: string; kind: string; status: string; modelId?: string }[];
  designUpdates?: {
    id: string;
    modelId: string;
    status: string;
    error?: string | null;
  }[];
  runs: (PipelineRun & {
    id: string;
    modelId?: string;
    estimatedCost: number | null;
    inputTokens: number;
    outputTokens: number;
    [key: string]: unknown;
  })[];
};
export function buildLabel(version: Build) {
  const stage = version.artifacts?.stage;
  return `Build ${version.iteration + 1}${stage === "geometry" ? " · Geometry" : stage === "surface" ? " · Materials" : ""}`;
}
export function resolveBuild(
  model: Model,
  versions: Build[],
  versionId?: string,
) {
  if (!versionId)
    return {
      artifacts: model.artifacts,
      feedback: model.feedback,
      target: model.artifacts?.visualTarget || model.visualTarget,
      version: undefined,
      missing: false,
    };
  const version = versions.find(
    (item) => item.id === versionId && item.modelId === model.id,
  );
  return {
    version,
    artifacts: version?.artifacts,
    feedback: version?.judges.find((judge) => judge.result)?.result,
    target: version?.artifacts?.visualTarget,
    missing: !version,
  };
}
export function modelStatus(model: Model) {
  if (model.status === "failed") return "Failed";
  if (model.verdict === "limit_reached") return "Completed with issues";
  if (model.verdict === "approved") return "Approved";
  if (model.status === "done") return "Complete";
  return model.status.replaceAll("_", " ");
}
