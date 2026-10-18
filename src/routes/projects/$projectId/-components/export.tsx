import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AssetImage } from "@/components/asset-image";
import { StatusBadge } from "@/components/status";
import { fileUrl, json, request } from "@/lib/client";
import { collectionAssetGroups } from "@/lib/project-summary";

/** Zip every saved file of the chosen finished assets, by default only the accepted ones. */
export function ExportPanel({ projectId, projectName, models }: {
  projectId: string;
  projectName: string;
  models: any[];
}) {
  const [doneOnly, setDoneOnly] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [archive, setArchive] = useState<{ url: string; assets: number; files: number } | null>(null);
  const finished = collectionAssetGroups(models).map((group) => group.representative).filter((m: any) => m.status === "done");
  const listed = finished.filter((m: any) => !doneOnly || m.acceptedAt);
  const chosen = listed.filter((m: any) => !excluded.has(m.id));
  const fileName = `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "assets"}.zip`;
  function toggle(id: string) {
    const next = new Set(excluded);
    if (!next.delete(id)) next.add(id);
    setExcluded(next);
  }
  async function exportZip() {
    setBusy(true);
    setError("");
    setArchive(null);
    try {
      const result = await request(`projects/${projectId}/export`, json({ modelIds: chosen.map((m: any) => m.id) }));
      setArchive(result);
      const link = document.createElement("a");
      link.href = result.url;
      link.download = fileName;
      link.click();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="export-section" aria-label="Export">
    <div className="export-toolbar">
      <div className="flex items-center gap-2">
        <Switch id="export-done-only" checked={doneOnly} onCheckedChange={setDoneOnly} />
        <Label htmlFor="export-done-only">Only done items</Label>
      </div>
      <Button variant="ghost" size="sm" disabled={!listed.length}
        onClick={() => setExcluded(chosen.length ? new Set(listed.map((m: any) => m.id)) : new Set())}>
        {chosen.length ? "Select none" : "Select all"}
      </Button>
      <Button disabled={!chosen.length || busy} onClick={exportZip}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <Download size={16} />}
        {busy ? "Preparing zip…" : `Export ${chosen.length} as zip`}
      </Button>
    </div>
    <p className="muted">The zip holds every saved file of each asset (models, Blender sources, renders, LODs, sprites, images and visual targets) with a manifest.</p>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {archive && <p role="status" className="muted">
      Exported {archive.assets} {archive.assets === 1 ? "asset" : "assets"} and {archive.files} files. <a className="underline" href={archive.url} download={fileName}>Download again</a>
    </p>}
    {!listed.length ? <Empty className="empty">
      <h2>{doneOnly ? "No done items yet" : "No finished assets yet"}</h2>
      <p>{doneOnly ? "Accept assets in the Review stage, or include every finished asset." : "Finished assets appear here once generation completes."}</p>
      {doneOnly && finished.length > 0 && <Button variant="outline" onClick={() => setDoneOnly(false)}>Include all finished</Button>}
    </Empty> : <ul className="export-list">
      {listed.map((m: any) => {
        const name = m.name.replaceAll("_", " ");
        const cover = m.artifacts?.image || m.artifacts?.renders?.[0] || m.visualTarget;
        return <li key={m.id}>
          <input id={`export-${m.id}`} type="checkbox" className="workshop-checkbox" checked={!excluded.has(m.id)} onChange={() => toggle(m.id)} />
          <span className="export-thumb">{cover && <AssetImage src={fileUrl(cover)} alt="" width={320} />}</span>
          <Label htmlFor={`export-${m.id}`}>{name}</Label>
          {m.acceptedAt ? <StatusBadge tone="done">Done</StatusBadge> : <StatusBadge tone="warning">Review</StatusBadge>}
        </li>;
      })}
    </ul>}
  </section>;
}
