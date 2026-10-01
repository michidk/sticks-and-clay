import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { GitBranch, LoaderCircle, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { request, json } from "@/lib/client";
import { pipelineSteps } from "../-lib/pipeline";
import {
  versionLabel,
  type Model,
  type Version,
  type Workspace,
} from "../-lib/model";

export function ModelConversation({
  projectId,
  model,
  workspace,
  versions,
  selectedVersionId,
  onInspect,
  onCreated,
  onRefresh,
}: {
  projectId: string;
  model: Model;
  workspace: Workspace;
  versions: Version[];
  selectedVersionId?: string;
  onInspect: (id: string) => void;
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
          name: kind === "fork" ? name : undefined,
          judgeIterations: rounds,
        }),
      );
      setPrompt("");
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
    <section
      className="model-conversation"
      aria-labelledby="model-conversation-title"
    >
      <header className="conversation-heading">
        <div className="eyebrow">MODEL CONVERSATION</div>
        <h2 id="model-conversation-title">Build story</h2>
        <p>The same saved steps as the pipeline, in reading order.</p>
      </header>
      <div className="conversation-feed" aria-live="polite">
        {parent && (
          <div className="conversation-item conversation-user">
            <GitBranch size={16} />
            <span>
              {model.branchKind === "fork" ? "Forked" : "Iterated"} from{" "}
              <Link
                to="/projects/$projectId/models/$modelId"
                params={{ projectId, modelId: parent.id }}
                search={{ view: "3d", section: "review" }}
              >
                {parent.name.replaceAll("_", " ")}
              </Link>
              <br />
              {model.changePrompt}
            </span>
          </div>
        )}
        <details className="conversation-item conversation-user">
          <summary>Original build brief</summary>
          <p>{model.prompt}</p>
        </details>
        {steps.map((step) => (
          <article
            key={step.run.id}
            className="conversation-item conversation-agent"
          >
            <div className="conversation-item-title">
              <Sparkles size={15} />
              <strong>{step.label}</strong>
              <span>{step.state}</span>
            </div>
            <p>
              {step.review?.summary ||
                step.run.result?.summary ||
                step.run.error ||
                (step.state === "Running"
                  ? model.phase
                  : "Result recorded in activity history.")}
            </p>
            {step.review && (
              <small>
                {step.review.score}/100 · {step.review.improvements.length}{" "}
                finding{step.review.improvements.length === 1 ? "" : "s"}
              </small>
            )}
            {step.version && (
              <Button
                variant="link"
                onClick={() => onInspect(step.version!.id)}
              >
                Inspect {versionLabel(step.version)} →
              </Button>
            )}
          </article>
        ))}
        {!steps.length && (
          <p className="conversation-empty">
            The queued build will appear here as steps are recorded.
          </p>
        )}
        {children.map((child) => (
          <div key={child.id} className="conversation-item conversation-agent">
            <GitBranch size={15} />
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
      </div>
      <div className="conversation-compose">
        <h3>Continue from a saved version</h3>
        <p>
          {source
            ? `Starting from ${versionLabel(source)}. Select another version in the viewer to change the source.`
            : "A saved Blender version is needed before continuing."}
        </p>
        <div
          className="conversation-mode"
          role="group"
          aria-label="Continuation type"
        >
          <Button
            variant={kind === "iterate" ? "default" : "outline"}
            onClick={() => setKind("iterate")}
          >
            Iterate
          </Button>
          <Button
            variant={kind === "fork" ? "default" : "outline"}
            onClick={() => setKind("fork")}
          >
            Fork variant
          </Button>
        </div>
        {kind === "fork" && (
          <div>
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
        <div>
          <Label htmlFor="continuation-prompt">What should change?</Label>
          <Textarea
            id="continuation-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={12000}
            placeholder="Describe the shape, construction or materials you want changed…"
            rows={4}
          />
        </div>
        <div>
          <Label htmlFor="continuation-rounds">Review rounds per stage</Label>
          <Input
            id="continuation-rounds"
            type="number"
            min={0}
            max={5}
            value={rounds}
            onChange={(event) => setRounds(Number(event.target.value))}
          />
        </div>
        <Button
          disabled={
            busy ||
            !source ||
            prompt.trim().length < 3 ||
            (kind === "fork" && !name.trim()) ||
            !Number.isInteger(rounds) ||
            rounds < 0 ||
            rounds > 5
          }
          onClick={createBranch}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Send size={16} />
          )}
          {kind === "fork" ? "Create fork" : "Iterate model"}
        </Button>
        <div className="conversation-design">
          <h3>Use this model in the design</h3>
          <p>
            AI drafts a new design revision using the model and references. One
            selected render joins the project references. Review and approve the
            draft in the project workspace.
          </p>
          <Label htmlFor="design-view">Reference view</Label>
          <select
            id="design-view"
            value={view}
            onChange={(event) => setView(Number(event.target.value))}
            disabled={!source?.artifacts?.renders?.length}
          >
            {source?.artifacts?.renders?.map((_, index) => (
              <option key={index} value={index}>
                View {index + 1}
              </option>
            ))}
          </select>
          {workspace.project.references.length >= 6 && (
            <div className="conversation-replacement">
              <Label htmlFor="replace-reference">Replace a reference</Label>
              <select
                id="replace-reference"
                value={replaceReference}
                onChange={(event) => setReplaceReference(event.target.value)}
              >
                <option value="">Choose a reference</option>
                {workspace.project.references.map((key, index) => (
                  <option key={key} value={key}>
                    Reference {index + 1}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button
            variant="outline"
            disabled={
              busy ||
              !source?.artifacts?.renders?.length ||
              (workspace.project.references.length >= 6 && !replaceReference) ||
              updates.some((item) =>
                ["queued", "running"].includes(item.status),
              )
            }
            onClick={updateDesign}
          >
            Draft design update
          </Button>
          {workspace.project.references.length >= 6 && (
            <small>
              The selected reference will be replaced in the new draft. Existing
              batches keep their snapshots.
            </small>
          )}
          {updates[0] && (
            <small>
              Latest design update: {updates[0].status}
              {updates[0].error ? ` · ${updates[0].error}` : ""}
            </small>
          )}
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </section>
  );
}
