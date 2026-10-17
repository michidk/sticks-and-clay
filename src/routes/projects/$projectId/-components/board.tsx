import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Boxes, Check, Play, Trash2, Undo2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AssetImage } from "@/components/asset-image";
import { StatusBadge } from "@/components/status";
import { assetStage, boardColumns, boardStages, boardStageTitles, latestSourceRun } from "@/lib/board";
import { fileUrl, json, request } from "@/lib/client";
import { GenerationDialog } from "./generation-dialog";
import { GraphicVariant } from "./graphic-variant";
import { ideaBrief, ideaSettings, ideaTitle, useIdeaActions, type ModelIdea } from "./model-ideas";

/** Every idea and asset in its stage: Ideas, Ready, In progress, Review and Done. */
export function Board({ projectId, project, ideas, models, batches, runs, onRefresh }: {
  projectId: string;
  project: { assetType: string; designVersion: number; status: string; archivedAt?: string | null };
  ideas: ModelIdea[];
  models: any[];
  batches: any[];
  runs: any[];
  onRefresh: () => Promise<unknown>;
}) {
  const isGraphics = project.assetType !== "model";
  const ready = project.status === "ready" && !project.archivedAt;
  const columns = boardColumns(ideas, models, batches);
  const ideaActions = useIdeaActions(projectId, onRefresh);
  const [editing, setEditing] = useState<ModelIdea | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function send(id: string, path: string, body: unknown) {
    setBusy(id);
    setError("");
    try {
      await request(path, json(body));
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const locked = busy !== null || ideaActions.pending !== null;
  const ideaCard = (idea: ModelIdea) => {
    const brief = ideaBrief(idea);
    return <li key={idea.id} className="board-card">
      <button type="button" className="board-card-title idea-brief" title={`Edit: ${brief}`} onClick={() => setEditing(idea)}>{ideaTitle(idea)}</button>
      <p className="muted">{idea.input.count} × · {ideaSettings(idea, isGraphics)}</p>
      <div className="board-card-actions">
        {idea.readyAt ? <>
          <Button size="sm" disabled={!ready || locked} onClick={() => ideaActions.act(idea, "generate")}><Play size={14} /> Start</Button>
          <Button size="icon-sm" variant="ghost" aria-label="Back to ideas" title="Back to ideas" disabled={locked} onClick={() => ideaActions.act(idea, "ready")}><Undo2 size={14} /></Button>
        </> : <Button size="sm" variant="outline" disabled={locked} onClick={() => ideaActions.act(idea, "ready")}><Check size={14} /> Mark ready</Button>}
        <Button size="icon-sm" variant="ghost" aria-label="Discard idea" disabled={locked} onClick={() => ideaActions.act(idea, "discard")}><Trash2 size={14} /></Button>
      </div>
    </li>;
  };
  const assetCard = (m: any, attempts: number) => {
    const name = m.name.replaceAll("_", " ");
    const cover = m.artifacts?.image || m.artifacts?.renders?.[0] || m.visualTarget;
    const link = { to: "/projects/$projectId/models/$modelId" as const, params: { projectId, modelId: m.id } };
    const stage = assetStage(m);
    const sourceRunId = latestSourceRun(runs, m.id);
    return <li key={m.id} className="board-card">
      <div className="board-cover">
        {cover ? <AssetImage src={fileUrl(cover)} alt={name} width={320} /> : <Boxes size={28} strokeWidth={1} aria-hidden="true" />}
      </div>
      {isGraphics ? <span className="board-card-title">{name}</span>
        : <Link className="board-card-title" {...link} search={{ view: m.artifacts ? "3d" : "target", section: "review" }}>{name}</Link>}
      <div className="board-card-meta">
        <StatusBadge status={m.status} verdict={m.verdict} />
        {attempts > 1 && <span className="muted">Iteration {attempts}</span>}
      </div>
      <div className="board-card-actions">
        {stage === "review" && <>
          <Button size="sm" disabled={locked} onClick={() => send(m.id, `models/${m.id}/accept`, { accepted: true })}><Check size={14} /> Accept</Button>
          {isGraphics ? <GraphicVariant kind="iterate" model={m} sourceRunId={sourceRunId} onSaved={onRefresh} />
            : <Button size="sm" variant="outline" asChild><Link {...link} search={{ view: "3d", section: "review" }}>Iterate</Link></Button>}
        </>}
        {stage === "done" && <Button size="sm" variant="ghost" disabled={locked} onClick={() => send(m.id, `models/${m.id}/accept`, { accepted: false })}>
          <Undo2 size={14} /> Back to review
        </Button>}
        {m.status === "failed" && <Button size="sm" variant="outline" disabled={locked} onClick={() => send(m.id, `models/${m.id}/retry`, {})}>Resume</Button>}
        {m.status === "awaiting_approval" && <Button size="sm" variant="outline" asChild><Link {...link} search={{ view: "target", section: "review" }}>Review target</Link></Button>}
      </div>
    </li>;
  };
  return <section className="board-section" aria-label="Board">
    {(error || ideaActions.error) && <Alert variant="destructive"><AlertDescription>{error || ideaActions.error}</AlertDescription></Alert>}
    <div className="board">
      {boardStages.map((stage) => <section key={stage} className="board-column" aria-labelledby={`board-${stage}`}>
        <h2 id={`board-${stage}`}>{boardStageTitles[stage]} <span className="count">{columns[stage].length}</span></h2>
        <ul>
          {columns[stage].map((card) => card.kind === "idea" ? ideaCard(card.idea)
            : card.kind === "pending" ? <li key={card.batch.id} className="board-card">
              <span className="board-card-title" title={card.batch.prompt}>{card.batch.prompt.split("\n")[0] || "AI-proposed assets"}</span>
              <div className="board-card-meta">
                <StatusBadge status={card.batch.status} />
                <span className="muted">{card.owed} planned</span>
              </div>
              {card.batch.status === "failed" && <div className="board-card-actions">
                <Button size="sm" variant="outline" disabled={locked} onClick={() => send(card.batch.id, `batches/${card.batch.id}/resume`, {})}>Resume</Button>
              </div>}
            </li>
            : assetCard(card.asset, card.attempts))}
        </ul>
        {!columns[stage].length && <p className="board-empty muted">Nothing here</p>}
      </section>)}
    </div>
    {editing && <GenerationDialog
      key={editing.id}
      idea={editing}
      projectId={projectId}
      designVersion={project.designVersion}
      ready={ready}
      isGraphics={isGraphics}
      open
      onOpenChange={(open) => { if (!open) setEditing(null); }}
      onRefresh={onRefresh}
      onSaved={async () => { await onRefresh(); }}
    />}
  </section>;
}
