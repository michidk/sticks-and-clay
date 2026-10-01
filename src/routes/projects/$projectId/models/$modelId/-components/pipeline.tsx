import { useEffect, useRef, useState } from "react";
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
import { Progress } from "@/components/progress";
import { agentStateFromStatus } from "@/components/agent-state";
import { money } from "@/lib/client";
import {
  modelStatus,
  versionLabel,
  type Model,
  type Version,
} from "../-lib/model";
import { pipelineSteps, type PipelineRun } from "../-lib/pipeline";
import { ReviewNotes } from "./review";

const icons = {
  "visual-target": Image,
  builder: Boxes,
  photographer: Camera,
  judge: ScanEye,
};
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
  const [expanded, setExpanded] = useState(false);
  const [selectedId, select] = useState<string>();
  const selected = steps.find((step) => step.run.id === selectedId);
  const track = useRef<HTMLOListElement>(null);
  const active = !["done", "failed", "cancelled"].includes(model.status);
  const running = [...steps].reverse().find((step) => step.state === "Running");
  const followKey = running?.run.id || steps.at(-1)?.run.id;
  useEffect(() => {
    const node = track.current?.querySelector<HTMLElement>(
      '[data-current="true"]',
    );
    if (node && track.current)
      track.current.scrollLeft = Math.max(
        0,
        node.offsetLeft - track.current.offsetLeft - 24,
      );
  }, [model.id, followKey, expanded]);
  return (
    <section className="model-pipeline" aria-labelledby="model-pipeline-title">
      <div className="pipeline-heading">
        <div>
          <h2 id="model-pipeline-title">
            <GitBranch size={19} /> Generation pipeline
          </h2>
        </div>
        <span className="pipeline-count">
          {active ? model.phase : modelStatus(model)} ·{" "}
          {steps.filter((s) => s.review).length} reviews · {versions.length}{" "}
          build{versions.length === 1 ? "" : "s"}
        </span>
        <Button
          variant="outline"
          aria-expanded={expanded}
          aria-controls="pipeline-details"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide pipeline" : "Show pipeline"}
        </Button>
      </div>
      {!expanded && !!steps.length && (
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
                  aria-label={`${step.label}: ${step.state}. Show step details`}
                  onClick={() => {
                    setExpanded(true);
                    select(step.run.id);
                  }}
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
          <li className="pipeline-strip-outcome">
            {active ? model.phase : modelStatus(model)}
          </li>
        </ol>
      )}
      {active && !expanded && (
        <div className="pipeline-progress-compact">
          <Progress
            value={model.progress}
            label={model.phase}
            agentState={agentStateFromStatus(model.status)}
          />
        </div>
      )}
      {expanded && (
        <div id="pipeline-details">
          <div className="pipeline-progress" aria-live="polite">
            <Progress
              value={model.progress}
              label={active ? model.phase : modelStatus(model)}
              agentState={agentStateFromStatus(model.status)}
            />
            <p>
              Recorded stages, left to right. Select a step to inspect its
              result.
            </p>
          </div>
          <ol
            ref={track}
            className="pipeline-track"
            aria-label="Generation steps"
            tabIndex={0}
          >
            {steps.map((step, index) => {
              const Icon = icons[step.run.role as keyof typeof icons];
              const warning = step.state === "Changes requested";
              const failed = ["Failed", "Interrupted", "Cancelled"].includes(
                step.state,
              );
              const running = step.state === "Running";
              return (
                <li key={step.run.id} data-current={step.run.id === followKey}>
                  <Button
                    variant="outline"
                    className={
                      "pipeline-node " +
                      (running
                        ? "is-running"
                        : failed
                          ? "is-failed"
                          : warning
                            ? "is-warning"
                            : "")
                    }
                    aria-pressed={selectedId === step.run.id}
                    onClick={() =>
                      select(
                        selectedId === step.run.id ? undefined : step.run.id,
                      )
                    }
                  >
                    <span className="pipeline-node-top">
                      <Icon size={17} />
                      <span>{String(index + 1).padStart(2, "0")}</span>
                    </span>
                    <strong>{step.label}</strong>
                    <span className="pipeline-node-subtitle">
                      {step.version
                        ? versionLabel(step.version)
                        : step.run.role === "visual-target"
                          ? "Design direction"
                          : `Iteration ${step.run.iteration + 1}`}
                    </span>
                    <span className="pipeline-node-state">
                      {running ? (
                        <LoaderCircle size={13} className="spin" />
                      ) : failed || warning ? (
                        <CircleAlert size={13} />
                      ) : step.state === "Complete" ||
                        step.state === "Passed" ? (
                        <Check size={13} />
                      ) : (
                        <Clock3 size={13} />
                      )}
                      {step.review ? `${step.review.score}/100 · ` : ""}
                      {step.state}
                    </span>
                  </Button>
                  <span className="pipeline-edge" aria-hidden="true">
                    <span>
                      {warning && steps[index + 1]?.run.role === "builder"
                        ? "Revise"
                        : ""}
                    </span>
                    <ArrowRight size={18} />
                  </span>
                </li>
              );
            })}
            <li className="pipeline-outcome">
              <span className={"pipeline-end " + (active ? "is-running" : "")}>
                {active ? (
                  <LoaderCircle size={19} className="spin" />
                ) : model.status === "done" &&
                  model.verdict !== "limit_reached" ? (
                  <Check size={19} />
                ) : (
                  <CircleAlert size={19} />
                )}
              </span>
              <strong>{active ? model.phase : modelStatus(model)}</strong>
              <small>
                {active ? "Updates automatically" : "Current outcome"}
              </small>
            </li>
          </ol>
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
                    onClick={() =>
                      onInspect(selected.version!.id, "3d", "review")
                    }
                  >
                    Inspect this version <ArrowRight size={14} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => onInspect(undefined, "3d", "activity")}
                >
                  Activity & cost <ArrowRight size={14} />
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
        </div>
      )}
    </section>
  );
}
