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
  glb: string;
  blend: string;
  renders: string[];
  stage?: string;
  visualTarget?: string;
  textures?: { key: string; name: string; kind: string }[];
  metrics: { triangles?: number; dimensions?: number[] };
};
export type Model = {
  id: string;
  name: string;
  prompt: string;
  status: string;
  phase: string;
  progress: number;
  verdict?: string;
  error?: string;
  visualTarget?: string;
  artifacts?: Artifacts;
  feedback?: Review;
};
export type Version = {
  id: string;
  modelId: string;
  iteration: number;
  status: string;
  createdAt: string;
  artifacts?: Artifacts;
  summary?: string;
  error?: string;
  judges: { id: string; status: string; result?: Review; error?: string }[];
};
export type Workspace = {
  project: { id: string; name: string };
  models: Model[];
  versions: Version[];
  runs: {
    id: string;
    modelId?: string;
    estimatedCost: number | null;
    inputTokens: number;
    outputTokens: number;
    [key: string]: unknown;
  }[];
};
export function versionLabel(version: Version) {
  const stage = version.artifacts?.stage;
  return `Iteration ${version.iteration + 1}${stage === "geometry" ? " · Geometry" : stage === "surface" ? " · Materials" : ""}`;
}
export function resolveVersion(
  model: Model,
  versions: Version[],
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
