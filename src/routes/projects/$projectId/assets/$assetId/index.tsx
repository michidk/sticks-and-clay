import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AssetLifecycle } from "@/components/board";
import { AssetReferences } from "@/components/asset-references";
import { WorkspaceSkeleton } from "@/components/loading";
import { StatusBadge } from "@/components/status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { request } from "@/lib/client";
import type { BoardAsset, BoardProject } from "@/lib/board-data";
import { GenerationDialog } from "../../-components/generation-dialog";
import { ideaTitle, ideaBrief } from "../../-components/asset-drafts";

export const Route = createFileRoute("/projects/$projectId/assets/$assetId/")({ component: AssetPage });
type AssetWorkspace = Omit<BoardProject, "project" | "models"> & { project: BoardProject["project"]; assets: BoardAsset[]; assetVersions: BoardProject["models"] };
function AssetPage() {
  const { projectId, assetId } = Route.useParams();
  const [data, setData] = useState<AssetWorkspace | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const refresh = useCallback(async () => {
    const data = await request<AssetWorkspace>(`projects/${projectId}?summary=true&versions=false`);
    setData(data); setError("");
  }, [projectId]);
  useEffect(() => {
    let active = true;
    setData(null);
    const load = async () => {
      try {
        const data = await request<AssetWorkspace>(`projects/${projectId}?summary=true&versions=false`);
        if (active) { setData(data); setError(""); }
      } catch (error) { if (active) setError(error instanceof Error ? error.message : "Could not load this asset"); }
    };
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId, assetId]);
  const asset = data?.assets.find((asset) => asset.id === assetId);
  const versions = data?.assetVersions.filter((version) => version.assetId === assetId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) ?? [];
  return <main>
    <Link to="/projects/$projectId" params={{ projectId }} search={{ tab: "board" }}>Back to project board</Link>
    {error && <Alert variant="destructive"><AlertDescription>{error} <Button variant="ghost" size="sm" onClick={() => refresh().catch((error) => setError(error instanceof Error ? error.message : "Could not load this asset"))}>Retry</Button></AlertDescription></Alert>}
    {!data && !error && <WorkspaceSkeleton />}
    {data && !asset && <p className="muted mt-6">Asset not found in this project.</p>}
    {data && asset && <>
      <header className="my-6"><p className="muted">{data.project.name} · Asset</p><h1>{ideaTitle(asset)}</h1><p className="whitespace-pre-wrap mt-3">{ideaBrief(asset)}</p>{!data.project.archivedAt && <Button className="mt-4" variant="outline" onClick={() => setEditing(true)}>Edit asset</Button>}</header>
      {asset.input.parts?.length ? <section className="mb-6"><h2>Parts</h2><ul>{asset.input.parts.map((part) => <li key={part.name}><strong>{part.name}</strong> · {part.brief}</li>)}</ul></section> : null}
      {editing && <GenerationDialog idea={asset} projectId={projectId} designVersion={data.project.designVersion} ready={data.project.status === "ready" && !data.project.archivedAt} isGraphics={data.project.assetType !== "model"} open onOpenChange={setEditing} onRefresh={refresh} onSaved={async () => { await refresh(); }} />}
      <AssetLifecycle entry={{ ...data, models: data.assetVersions }} assetId={assetId} onRefresh={refresh} />
      {!data.project.archivedAt && <section className="my-8"><h2>References for future versions</h2><p className="muted mb-4">Saved versions keep their original design and references.</p><AssetReferences projectId={projectId} assetId={assetId} references={asset.references ?? []} referenceNotes={asset.referenceNotes ?? {}} onRefresh={refresh} /></section>}
      <section className="my-8"><h2>Version history</h2>
        {!versions.length ? <p className="muted">This asset has no generated versions yet.</p> : <ul className="space-y-3 mt-4">{versions.map((version, index) => <li key={version.id} className="flex flex-wrap items-center gap-3">
          <Link to="/projects/$projectId/models/$modelId" params={{ projectId, modelId: version.id }} search={{ view: data.project.assetType === "model" ? "3d" : "target", section: "review" }}>Version {versions.length - index}</Link>
          <StatusBadge status={version.status} verdict={version.verdict} />
          <time className="muted" dateTime={new Date(version.createdAt).toISOString()}>{new Date(version.createdAt).toLocaleString()}</time>
          {version.acceptedAt && <span className="muted">Accepted</span>}
        </li>)}</ul>}
      </section>
    </>}
  </main>;
}
