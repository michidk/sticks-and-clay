import type { Model, Review, Version } from "./model";

export type PipelineRun = {
  id: string;
  modelId?: string | null;
  role: string;
  status: string;
  iteration: number;
  createdAt: string;
  finishedAt?: string | null;
  estimatedCost: number | null;
  error?: string | null;
  result?: {
    photography?: { builderRunId?: string };
    summary?: string;
    score?: number;
    passed?: boolean;
    improvements?: Review["improvements"];
  } | null;
};
export type PipelineStep = {
  run: PipelineRun;
  label: string;
  state: string;
  version?: Version;
  review?: Review;
};
const labels: Record<string, string> = {
  "visual-target": "Visual target",
  builder: "Build",
  photographer: "Photography",
  judge: "Judge",
};
/** Use saved run associations, never iteration numbers alone across retries. */
export function pipelineSteps(
  model: Model,
  runs: PipelineRun[],
  versions: Version[],
): PipelineStep[] {
  const terminal = ["done", "failed", "cancelled"].includes(model.status);
  const ordered = runs
    .filter((run) => run.modelId === model.id && labels[run.role])
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return ordered.map((run) => {
    const version = versions.find(
      (v) =>
        v.modelId === model.id &&
        (v.id === run.id ||
          v.id === run.result?.photography?.builderRunId ||
          v.judges.some((j) => j.id === run.id)),
    );
    const result = run.result;
    const review =
      run.role === "judge" &&
      typeof result?.score === "number" &&
      typeof result.passed === "boolean"
        ? {
            score: result.score,
            passed: result.passed,
            summary: result.summary || "",
            improvements: result.improvements || [],
          }
        : undefined;
    const state =
      run.status === "running"
        ? terminal
          ? "Interrupted"
          : "Running"
        : run.status === "failed"
          ? "Failed"
          : run.status === "cancelled"
            ? "Cancelled"
            : run.status === "done"
              ? review
                ? review.passed
                  ? "Passed"
                  : "Changes requested"
                : "Complete"
              : run.status;
    return { run, label: labels[run.role], state, version, review };
  });
}
