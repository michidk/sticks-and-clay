import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Boxes, Check, Play, Trash2, Undo2, Images } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AssetImage } from "@/components/asset-image";
import { StatusBadge } from "@/components/status";
import { AssetReferences } from "@/components/asset-references";
import { assetStage, boardColumns, boardStages, boardStageTitles, latestSourceRun } from "@/lib/board";
import type { BoardAsset, BoardProject, BoardVersion } from "@/lib/board-data";
import { fileUrl, json, request } from "@/lib/client";
import { usePending } from "@/hooks/use-pending";
import { GenerationDialog } from "@/routes/projects/$projectId/-components/generation-dialog";
import { GraphicVariant } from "@/routes/projects/$projectId/-components/graphic-variant";
import { ReturnToIdea } from "@/routes/projects/$projectId/-components/return-to-idea";
import { ideaBrief, ideaSettings, ideaTitle, useIdeaActions } from "@/routes/projects/$projectId/-components/asset-drafts";

type Context = { entry: BoardProject; showProject: boolean; onRefresh: () => Promise<unknown> };
function ProjectLabel({ entry, showProject }: Pick<Context, "entry" | "showProject">) {
  return showProject ? <Link to="/projects/$projectId" params={{ projectId: entry.project.id }}><Badge variant="outline">{entry.project.name}</Badge></Link> : null;
}
function References({ asset, projectId, onRefresh }: { asset?: BoardAsset; projectId: string; onRefresh: Context["onRefresh"] }) {
  const [open, setOpen] = useState(false);
  if (!asset) return null;
  return <>
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Images size={14} /> References</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Asset references</DialogTitle><DialogDescription>Changes apply to future versions. Saved versions keep their original references.</DialogDescription></DialogHeader>
      {open && <AssetReferences projectId={projectId} assetId={asset.id} references={asset.references ?? []} referenceNotes={asset.referenceNotes ?? {}} onRefresh={onRefresh} />}
    </DialogContent></Dialog>
  </>;
}
function IdeaCard({ idea, entry, showProject, onRefresh }: Context & { idea: BoardAsset }) {
  const { project } = entry;
  const actions = useIdeaActions(project.id, onRefresh);
  const [editing, setEditing] = useState(false);
  const ready = project.status === "ready" && !project.archivedAt;
  return <li className="board-card">
    <ProjectLabel entry={entry} showProject={showProject} />
    <Link to="/projects/$projectId/assets/$assetId" params={{ projectId: project.id, assetId: idea.id }} className="board-card-title idea-brief" title={ideaBrief(idea)}>{ideaTitle(idea)}</Link>
    <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit asset</Button>
    <p className="muted">{ideaSettings(idea, project.assetType !== "model")}</p>
    {actions.error && <Alert variant="destructive"><AlertDescription>{actions.error}</AlertDescription></Alert>}
    <div className="board-card-actions">
      {idea.readyAt ? <>
        <Button size="sm" disabled={!ready || actions.isPending(idea, "generate")} onClick={() => actions.act(idea, "generate")}><Play size={14} /> Start</Button>
        <Button size="icon-sm" variant="ghost" aria-label="Back to ideas" title="Back to ideas" disabled={!!project.archivedAt || actions.isPending(idea, "ready")} onClick={() => actions.act(idea, "ready")}><Undo2 size={14} /></Button>
      </> : <Button size="sm" variant="outline" disabled={!!project.archivedAt || actions.isPending(idea, "ready")} onClick={() => actions.act(idea, "ready")}><Check size={14} /> Mark ready</Button>}
      <Button size="icon-sm" variant="ghost" aria-label="Discard asset" disabled={!!project.archivedAt || actions.isPending(idea, "discard")} onClick={() => actions.act(idea, "discard")}><Trash2 size={14} /></Button>
      {!project.archivedAt && <References asset={idea} projectId={project.id} onRefresh={onRefresh} />}
    </div>
    {editing && <GenerationDialog key={idea.id} idea={idea} projectId={project.id} designVersion={project.designVersion} ready={ready} isGraphics={project.assetType !== "model"} open onOpenChange={setEditing} onRefresh={onRefresh} onSaved={async () => { await onRefresh(); }} />}
  </li>;
}
function useBoardAction(onRefresh: Context["onRefresh"]) {
  const pending = usePending();
  const [error, setError] = useState("");
  const send = (path: string, body: unknown) => pending.run(path, async () => {
    setError("");
    try { await request(path, json(body)); await onRefresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not update this asset"); }
  });
  return { pending, error, send };
}
function VersionCard({ version, root, count, entry, showProject, onRefresh }: Context & { version: BoardVersion; root: BoardVersion; count: number }) {
  const { project } = entry;
  const { pending, error, send } = useBoardAction(onRefresh);
  const asset = entry.assets?.find((asset) => asset.id === version.assetId);
  const name = asset?.title || version.name.replaceAll("_", " ");
  const image = version.artifacts?.image;
  const renders = version.artifacts?.renders;
  const cover = typeof image === "string" ? image : Array.isArray(renders) && typeof renders[0] === "string" ? renders[0] : version.visualTarget;
  const link = { to: "/projects/$projectId/models/$modelId" as const, params: { projectId: project.id, modelId: version.id } };
  const stage = assetStage(version);
  const isGraphics = project.assetType !== "model";
  return <li className="board-card">
    <ProjectLabel entry={entry} showProject={showProject} />
    <Link {...link} search={{ view: isGraphics ? "target" : version.artifacts ? "3d" : "target", section: "review" }} className="board-cover" aria-label={`Open ${name}`}>
      {cover ? <AssetImage src={fileUrl(cover)} alt={name} width={320} /> : <Boxes size={28} strokeWidth={1} aria-hidden="true" />}
    </Link>
    {version.assetId ? <Link className="board-card-title" to="/projects/$projectId/assets/$assetId" params={{ projectId: project.id, assetId: version.assetId }}>{name}</Link> : <Link className="board-card-title" {...link} search={{ view: isGraphics ? "target" : version.artifacts ? "3d" : "target", section: "review" }}>{name}</Link>}
    <div className="board-card-meta"><StatusBadge status={version.status} verdict={version.verdict} /><span className="muted">Version {count}</span></div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {!project.archivedAt && <div className="board-card-actions">
      {stage === "review" && <>
        <Button size="sm" disabled={pending.has(`models/${version.id}/accept`)} onClick={() => send(`models/${version.id}/accept`, { accepted: true })}><Check size={14} /> Accept</Button>
        {isGraphics ? <GraphicVariant kind="iterate" model={version} sourceRunId={latestSourceRun(entry.runs, version.id)} onSaved={onRefresh} /> : <Button size="sm" variant="outline" asChild><Link {...link} search={{ view: "3d", section: "review" }}>Iterate</Link></Button>}
      </>}
      {stage === "done" && <Button size="sm" variant="ghost" disabled={pending.has(`models/${version.id}/accept`)} onClick={() => send(`models/${version.id}/accept`, { accepted: false })}><Undo2 size={14} /> Back to review</Button>}
      {version.status === "failed" && <Button size="sm" variant="outline" disabled={pending.has(`models/${version.id}/retry`)} onClick={() => send(`models/${version.id}/retry`, {})}>Resume</Button>}
      {version.status === "awaiting_approval" && <Button size="sm" variant="outline" asChild><Link {...link} search={{ view: "target", section: "review" }}>Review target</Link></Button>}
      <References asset={asset} projectId={project.id} onRefresh={onRefresh} />
      <ReturnToIdea id={root.id} name={name} noun="asset" versions={count} canDelete={false} onDone={onRefresh} />
    </div>}
  </li>;
}
function PendingCard({ batch, owed, entry, showProject, onRefresh }: Context & { batch: BoardProject["batches"][number]; owed: number }) {
  const { pending, error, send } = useBoardAction(onRefresh);
  return <li className="board-card">
    <ProjectLabel entry={entry} showProject={showProject} />
    <span className="board-card-title" title={batch.prompt}>{batch.prompt.split("\n")[0] || "Planning asset"}</span>
    <div className="board-card-meta"><StatusBadge status={batch.status} /><span className="muted">{owed} planned</span></div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {batch.status === "failed" && !entry.project.archivedAt && <Button size="sm" variant="outline" disabled={pending.has(`batches/${batch.id}/resume`)} onClick={() => send(`batches/${batch.id}/resume`, {})}>Resume</Button>}
  </li>;
}

export function Board({ projects, showProjects = false, onRefresh }: { projects: BoardProject[]; showProjects?: boolean; onRefresh: Context["onRefresh"] }) {
  const entries = projects.map((entry) => {
    const draftIds = new Set(entry.assets?.filter((asset) => asset.inIdea).map((asset) => asset.id));
    const versions = entry.models.filter((version) => !version.assetId || !draftIds.has(version.assetId));
    const batches = entry.batches.map((batch) => ({ ...batch, count: batch.count - entry.models.filter((version) => version.batchId === batch.id && version.assetId && draftIds.has(version.assetId)).length }));
    return { entry, columns: boardColumns(entry.ideas, versions, batches) };
  });
  return <section className="board-section" aria-label="Asset board"><div className="board">
    {boardStages.map((stage) => {
      const count = entries.reduce((sum, item) => sum + item.columns[stage].length, 0);
      return <section key={stage} className="board-column" aria-labelledby={`board-${stage}`}>
        <h2 id={`board-${stage}`}>{boardStageTitles[stage]} <span className="count">{count}</span></h2>
        <ul>{entries.flatMap(({ entry, columns }) => columns[stage].map((card) => {
          const context = { entry, showProject: showProjects, onRefresh };
          return card.kind === "idea" ? <IdeaCard key={card.idea.id} {...context} idea={card.idea} />
            : card.kind === "pending" ? <PendingCard key={card.batch.id} {...context} batch={card.batch} owed={card.owed} />
            : <VersionCard key={card.asset.id} {...context} version={card.asset} root={card.root} count={card.attempts} />;
        }))}</ul>
        {!count && <p className="board-empty muted">Nothing here</p>}
      </section>;
    })}
  </div></section>;
}

export function AssetLifecycle({ entry, assetId, onRefresh }: { entry: BoardProject; assetId: string; onRefresh: Context["onRefresh"] }) {
  const asset = entry.assets?.find((asset) => asset.id === assetId);
  const versions = entry.models.filter((version) => version.assetId === assetId);
  const batchIds = new Set(versions.map((version) => version.batchId));
  const columns = boardColumns(asset?.inIdea ? [asset] : [], asset?.inIdea ? [] : versions, entry.batches.filter((batch) => batchIds.has(batch.id)));
  return <ul className="max-w-lg list-none p-0">{boardStages.flatMap((stage) => columns[stage].map((card) => {
    const context = { entry, showProject: false, onRefresh };
    return card.kind === "idea" ? <IdeaCard key={card.idea.id} {...context} idea={card.idea} />
      : card.kind === "pending" ? <PendingCard key={card.batch.id} {...context} batch={card.batch} owed={card.owed} />
      : <VersionCard key={card.asset.id} {...context} version={card.asset} root={card.root} count={card.attempts} />;
  }))}</ul>;
}
