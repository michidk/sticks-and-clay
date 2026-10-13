import { useState } from "react";
import {
  ArrowRight,
  Boxes,
  Camera,
  Check,
  CircleAlert,
  Clock3,
  GitBranch,
  Image,
  LoaderCircle,
  ScanEye,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/status";
import { money } from "@/lib/client";
import { modelStatus, type Model, type Version } from "../-lib/model";
import { pipelineSteps, type PipelineRun } from "../-lib/pipeline";
import { ReviewNotes } from "./review";

const icons = {
  "visual-target": Image,
  builder: Boxes,
  photographer: Camera,
  judge: ScanEye,
};
/** Recorded steps as a chip strip; selecting a chip opens that step's result. */
export function ModelPipeline({
  model,
  runs,
  versions,
  onInspect,
}: {
  model: Model;
  runs: PipelineRun[];
  versions: Version[];
  onInspect: (
    version: string | undefined,
    view: "3d" | "target",
    section: "review" | "activity",
  ) => void;
}) {
  const steps = pipelineSteps(model, runs, versions);
  const [selectedId, select] = useState<string>();
  const selected = steps.find((step) => step.run.id === selectedId);
  const active = !["done", "failed", "cancelled"].includes(model.status);
  const outcome = active ? model.phase : modelStatus(model);
  return (
    <section className="model-pipeline" aria-labelledby="model-pipeline-title">
      <div className="pipeline-heading">
        <h2 id="model-pipeline-title">
          <GitBranch size={19} /> Generation pipeline
        </h2>
        <span className="pipeline-count">
          {outcome} · {steps.filter((s) => s.review).length} reviews ·{" "}
          {versions.length} build{versions.length === 1 ? "" : "s"}
        </span>
      </div>
      {steps.length ? (
        <ol className="pipeline-strip" aria-label="Generation steps">
          {steps.map((step) => {
            const Icon = icons[step.run.role as keyof typeof icons];
            const tone =
              step.state === "Running"
                ? "is-running"
                : ["Failed", "Interrupted", "Cancelled"].includes(step.state)
                  ? "is-failed"
                  : step.state === "Changes requested"
                    ? "is-warning"
                    : step.state === "Passed"
                      ? "is-passed"
                      : "";
            return (
              <li key={step.run.id}>
                <button
                  type="button"
                  className={"pipeline-chip " + tone}
                  aria-pressed={selectedId === step.run.id}
                  aria-label={`${step.label}: ${step.state}. Show step details`}
                  onClick={() =>
                    select(selectedId === step.run.id ? undefined : step.run.id)
                  }
                >
                  <Icon size={14} />
                  <span>{step.label}</span>
                  {step.state === "Running" ? (
                    <LoaderCircle size={12} className="spin" />
                  ) : tone === "is-failed" || tone === "is-warning" ? (
                    <CircleAlert size={12} />
                  ) : step.state === "Complete" || step.state === "Passed" ? (
                    <Check size={12} />
                  ) : (
                    <Clock3 size={12} />
                  )}
                  {step.review && <small>{step.review.score}</small>}
                </button>
              </li>
            );
          })}
          <li className="pipeline-strip-outcome">{outcome}</li>
        </ol>
      ) : (
        <p className="conversation-empty">Steps appear here as the build runs.</p>
      )}
      {active && (
        <div className="pipeline-progress-compact">
          <Progress value={model.progress} label={model.phase} status={model.status} />
        </div>
      )}
      {selected && (
        <div className="pipeline-inspector">
          <div className="pipeline-inspector-heading">
            <div>
              <h3>
                {selected.label} <span>· {selected.state}</span>
              </h3>
              <p>
                {new Date(selected.run.createdAt).toLocaleString()} ·{" "}
                {selected.run.estimatedCost === null
                  ? "Cost pending"
                  : `${money(selected.run.estimatedCost)} estimated`}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close step details"
              onClick={() => select(undefined)}
            >
              <X size={17} />
            </Button>
          </div>
          <div className="pipeline-inspector-actions">
            {selected.version && (
              <Button
                variant="outline"
                onClick={() => onInspect(selected.version!.id, "3d", "review")}
              >
                Inspect this version <ArrowRight size={14} />
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => onInspect(undefined, "3d", "activity")}
            >
              Activity <ArrowRight size={14} />
            </Button>
          </div>
          {selected.run.error && (
            <p className="pipeline-error">{selected.run.error}</p>
          )}
          {selected.review ? (
            <ReviewNotes
              review={selected.review}
              renders={selected.version?.artifacts?.renders}
            />
          ) : (
            <p className="pipeline-summary">
              {selected.run.result?.summary ||
                (selected.state === "Running"
                  ? "This step is in progress. Its result will appear here."
                  : "Open activity to inspect the full request and response.")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
