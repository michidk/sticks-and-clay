import { VisualTargetReview } from "./visual-target-review";
import type { ObjectReference } from "@/lib/object-reference";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Boxes,
  Camera,
  Check,
  ChevronDown,
  GitBranch,
  Image,
  LoaderCircle,
  ScanEye,
  Send,
  Bot,
  X,
  Crosshair,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { request, json, fileUrl } from "@/lib/client";
import { AssetImage } from "@/components/asset-image";
import { pipelineSteps } from "../-lib/pipeline";
import {
  versionLabel,
  type Model,
  type Version,
  type Workspace,
} from "../-lib/model";

const roleIcons = {
  "visual-target": Image,
  builder: Boxes,
  photographer: Camera,
  judge: ScanEye,
};
export function ModelConversation({
  projectId,
  model,
  workspace,
  versions,
  selectedVersionId,
  objectReference,
  onClearObject,
  notice,
  onInspect,
  onReview,
  onCreated,
  onRefresh,
}: {
  projectId: string;
  model: Model;
  workspace: Workspace;
  versions: Version[];
  selectedVersionId?: string;
  objectReference: ObjectReference | null;
  onClearObject: () => void;
  notice?: ReactNode;
  onInspect: (id: string) => void;
  onReview: (id: string) => void;
  onCreated: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [kind, setKind] = useState<"iterate" | "fork">("iterate");
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [rounds, setRounds] = useState(
    workspace.batches.find((batch) => batch.id === model.batchId)
      ?.judgeIterations ?? 2,
  );
  const [view, setView] = useState(0);
  const [replaceReference, setReplaceReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const feed = useRef<HTMLDivElement>(null);
  const source = selectedVersionId
    ? versions.find((v) => v.id === selectedVersionId && v.artifacts?.blend)
    : versions.find((v) => v.artifacts?.blend);
  useEffect(() => setView(0), [source?.id]);
  const steps = pipelineSteps(model, workspace.runs, versions);
  const children = workspace.models.filter(
    (item) => item.parentModelId === model.id,
  );
  const parent = workspace.models.find(
    (item) => item.id === model.parentModelId,
  );
  const updates =
    workspace.designUpdates?.filter((item) => item.modelId === model.id) || [];
  const latestStep = steps.at(-1);
  const scrollKey = `${steps.length}:${latestStep?.state}:${children.length}`;
  useEffect(() => {
    const node = feed.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [model.id, scrollKey]);
  const canSubmit =
    !busy &&
    !!source &&
    (!objectReference || objectReference.glb === source.artifacts?.glb) &&
    prompt.trim().length >= 3 &&
    (kind !== "fork" || !!name.trim()) &&
    Number.isInteger(rounds) &&
    rounds >= 0 &&
    rounds <= 5;
  async function createBranch() {
    if (!source) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string }>(
        `models/${model.id}/branch`,
        json({
          kind,
          sourceRunId: source.id,
          prompt,
          objectReference: objectReference ?? undefined,
          name: kind === "fork" ? name : undefined,
          judgeIterations: rounds,
        }),
      );
      setPrompt("");
      onClearObject();
      onCreated(result.id);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function updateDesign() {
    if (!source) return;
    setBusy(true);
    setError("");
    try {
      await request(
        `models/${model.id}/design-update`,
        json({
          sourceRunId: source.id,
          view,
          replaceReference: replaceReference || undefined,
        }),
      );
      await onRefresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div
        ref={feed}
        className="studio-chat-feed"
        aria-live="polite"
        aria-label="Build story"
      >
        {parent && (
          <div className="chat-message is-user">
            <small>
              <GitBranch size={13} />
              {model.branchKind === "fork" ? "Forked" : "Iterated"} from{" "}
              <Link
                to="/projects/$projectId/models/$modelId"
                params={{ projectId, modelId: parent.id }}
                search={{ view: "3d", section: "review" }}
              >
                {parent.name.replaceAll("_", " ")}
              </Link>
            </small>
            <p>{model.changePrompt}</p>
            {model.objectReference && model.sourceRunId && (
              <Link
                className="chat-object-reference"
                to="/projects/$projectId/models/$modelId"
                params={{ projectId, modelId: parent.id }}
                search={{ view: "3d", section: "review", version: model.sourceRunId }}
                title={model.objectReference.path.join(" / ")}
              >
                <Crosshair size={14} /> {model.objectReference.name} · View source version
              </Link>
            )}
          </div>
        )}
        <details className="chat-message is-user chat-brief">
          <summary>Original build brief</summary>
          <p>{model.prompt}</p>
        </details>
        {steps.map((step) => {
          const Icon =
            roleIcons[step.run.role as keyof typeof roleIcons] || Bot;
          const tone =
            step.state === "Running"
              ? "is-running"
              : ["Failed", "Interrupted", "Cancelled"].includes(step.state)
                ? "is-failed"
                : ["Changes requested", "Awaiting approval"].includes(step.state)
                  ? "is-warning"
                  : "";
          // Finished steps fold to one line; the latest step stays open.
          const settled = step !== latestStep && step.state !== "Running";
          return (
            <details
              key={step.run.id}
              className={"chat-message is-agent " + tone}
              open={!settled}
            >
              <summary className="chat-agent-head">
                <span className="chat-agent-icon">
                  <Icon size={14} />
                </span>
                <strong>{step.label}</strong>
                {step.review && (
                  <span className="chat-agent-score">{step.review.score}</span>
                )}
                <span className="chat-agent-state">
                  {step.state === "Running" && (
                    <LoaderCircle size={12} className="spin" />
                  )}
                  {step.state}
                </span>
                <ChevronDown size={14} className="chat-agent-chevron" aria-hidden="true" />
              </summary>
              <p>
                {step.review?.summary ||
                  step.run.result?.summary ||
                  step.run.error ||
                  (step.state === "Running"
                    ? model.phase
                    : "Recorded in Activity.")}
              </p>
              {step.review && (
                <div className="chat-review-summary">
                  <strong>{step.review.score}/100</strong>
                  <span>
                    {step.review.passed ? "Passed" : "Changes requested"} ·{" "}
                    {step.review.improvements.length} finding
                    {step.review.improvements.length === 1 ? "" : "s"}
                  </span>
                </div>
              )}
              {step.version && (
                <div className="chat-message-actions">
                  {step.review && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onReview(step.version!.id)}
                    >
                      Read review
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onInspect(step.version!.id)}
                  >
                    Inspect {versionLabel(step.version)}{" "}
                    <ArrowUpRight size={13} />
                  </Button>
                </div>
              )}
            </details>
          );
        })}
        {!steps.length && (
          <p className="conversation-empty">
            Steps appear here as the build runs.
          </p>
        )}
        {children.map((child) => (
          <div key={child.id} className="chat-message is-note">
            <GitBranch size={13} />
            <span>
              {child.branchKind === "fork" ? "Fork" : "Iteration"}:{" "}
              <Link
                to="/projects/$projectId/models/$modelId"
                params={{ projectId, modelId: child.id }}
                search={{ view: "3d", section: "review" }}
              >
                {child.name.replaceAll("_", " ")}
              </Link>{" "}
              · {child.status}
            </span>
          </div>
        ))}
        {model.status === "awaiting_approval" && model.visualTarget && <VisualTargetReview
          key={model.visualTarget} modelId={model.id} target={model.visualTarget} onRefresh={onRefresh}
        />}
        {notice}
      </div>
      {model.status !== "awaiting_approval" && <div className="studio-chat-compose">
        <p className="studio-compose-source">
          {source
            ? `${kind === "fork" ? "Forking" : "Continuing"} from ${versionLabel(source)} · Ctrl or ⌘ + Enter sends`
            : "Needs a saved Blender version to continue from."}
        </p>
        {objectReference ? (
          <div className="studio-object-reference" aria-label="Referenced object">
            <Crosshair size={16} aria-hidden="true" />
            <div>
              <strong>{objectReference.name}</strong>
              <small>{objectReference.path.join(" / ")}</small>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove object reference" onClick={onClearObject}>
              <X size={16} />
            </Button>
          </div>
        ) : source && (
          <p className="studio-compose-source">Select a part in the 3D view or inspector to reference it here.</p>
        )}
        {kind === "fork" && (
          <div className="studio-compose-field">
            <Label htmlFor="fork-name">Variant name</Label>
            <Input
              id="fork-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="New variant name"
            />
          </div>
        )}
        <div className="studio-compose-box">
          <Textarea
            id="continuation-prompt"
            aria-label="What should change?"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                event.key === "Enter" &&
                canSubmit
              ) {
                event.preventDefault();
                void createBranch();
              }
            }}
            maxLength={12000}
            placeholder="Describe the shape, construction or materials you want changed…"
            rows={3}
          />
          <div className="studio-compose-row">
            <div
              className="conversation-mode"
              role="group"
              aria-label="Continuation type"
            >
              <Button
                type="button"
                size="sm"
                variant={kind === "iterate" ? "secondary" : "ghost"}
                aria-pressed={kind === "iterate"}
                onClick={() => setKind("iterate")}
              >
                Iterate
              </Button>
              <Button
                type="button"
                size="sm"
                variant={kind === "fork" ? "secondary" : "ghost"}
                aria-pressed={kind === "fork"}
                onClick={() => setKind("fork")}
              >
                Fork variant
              </Button>
            </div>
            <Label
              htmlFor="continuation-rounds"
              className="studio-compose-rounds"
            >
              Review rounds
              <Input
                id="continuation-rounds"
                type="number"
                min={0}
                max={5}
                value={rounds}
                onChange={(event) => setRounds(Number(event.target.value))}
              />
            </Label>
            <Button
              type="button"
              size="icon"
              aria-label={kind === "fork" ? "Create fork" : "Iterate model"}
              title={kind === "fork" ? "Create fork" : "Iterate model"}
              disabled={!canSubmit}
              onClick={createBranch}
            >
              {busy ? <LoaderCircle className="spin" /> : <Send />}
            </Button>
          </div>
        </div>
        <details className="studio-compose-design">
          <summary>Use this model in the design</summary>
          <div className="conversation-design">
            <p>
              AI drafts a new design revision using the model and references.
              One selected render joins the project references. Review and
              approve the draft in the project workspace.
            </p>
            <ImageChoice
              name="design-view"
              legend="Render to add as a reference"
              value={String(view)}
              onChange={(value) => setView(Number(value))}
              disabled={busy}
              emptyText="No renders are archived for this version yet."
              options={
                source?.artifacts?.renders?.map((key, index) => ({
                  value: String(index),
                  key,
                  label: `View ${index + 1}`,
                })) || []
              }
            />
            {workspace.project.references.length >= 6 && (
              <ImageChoice
                name="replace-reference"
                legend="Reference to replace"
                value={replaceReference}
                onChange={setReplaceReference}
                disabled={busy}
                options={workspace.project.references.map((key, index) => ({
                  value: key,
                  key,
                  label: `Reference ${index + 1}`,
                }))}
              />
            )}
            <Button
              variant="outline"
              disabled={
                busy ||
                !source?.artifacts?.renders?.length ||
                (workspace.project.references.length >= 6 &&
                  !replaceReference) ||
                workspace.designUpdates?.some((item) =>
                  ["queued", "running", "cancelling"].includes(item.status),
                )
              }
              onClick={updateDesign}
            >
              Draft design update
            </Button>
            {workspace.project.references.length >= 6 && (
              <small>
                The selected reference will be replaced in the new draft.
                Existing batches keep their snapshots.
              </small>
            )}
            {updates[0] && (
              <small>
                Latest design update: {updates[0].status}
                {updates[0].error ? ` · ${updates[0].error}` : ""}
              </small>
            )}
          </div>
        </details>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>}
    </>
  );
}

/** Thumbnail radio group: pick an image by seeing it, not by its number. */
function ImageChoice({
  name,
  legend,
  options,
  value,
  onChange,
  disabled,
  emptyText,
}: {
  name: string;
  legend: string;
  options: { value: string; key: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  return (
    <fieldset className="image-choice" disabled={disabled}>
      <legend>{legend}</legend>
      {options.length ? (
        <div className="image-choice-grid">
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <label
                key={option.value}
                className={selected ? "is-selected" : ""}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={selected}
                  onChange={() => onChange(option.value)}
                />
                <AssetImage
                  src={fileUrl(option.key)}
                  alt={option.label}
                  loading="lazy"
                />
                <span>{option.label}</span>
                {selected && <Check size={13} aria-hidden="true" />}
              </label>
            );
          })}
        </div>
      ) : (
        <p>{emptyText}</p>
      )}
    </fieldset>
  );
}
