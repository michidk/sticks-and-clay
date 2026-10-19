import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/status";
import { describeError } from "@/lib/error-message";

export type AssetHistoryEntry = {
  id: string;
  versionId: string | null;
  kind: string;
  detail: Record<string, any>;
  createdAt: string;
};

const labels: Record<string, string> = {
  created: "Created",
  ready: "Marked ready",
  unready: "Moved back to Ideas",
  started: "Generation started",
  returned_to_ideas: "Returned to Ideas",
  accepted: "Accepted",
  unaccepted: "Moved back to review",
};

/** Every recorded state and edit of one asset, newest first. */
export function AssetHistory({ projectId, entries, versionNumbers, view }: {
  projectId: string;
  entries: AssetHistoryEntry[];
  /** Version id → its 1-based number within the asset; deleted versions are absent. */
  versionNumbers: Map<string, number>;
  view: "3d" | "target";
}) {
  if (!entries.length) return <p className="muted">Nothing has been recorded for this asset yet.</p>;
  return <ol className="mt-4 space-y-3">{entries.map((entry) => {
    const { detail } = entry;
    const number = entry.versionId ? versionNumbers.get(entry.versionId) : undefined;
    const version = entry.versionId && (number
      ? <Link to="/projects/$projectId/models/$modelId" params={{ projectId, modelId: entry.versionId }} search={{ view, section: "review" }}>Version {number}</Link>
      : <span>Deleted version</span>);
    return <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <time className="muted min-w-40" dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleString()}</time>
      {entry.kind === "status" ? <>
        {version}
        <StatusBadge status={detail.to} verdict={detail.verdict} />
        {detail.phase && <span className="muted">{detail.phase}</span>}
        {detail.error && <span className="text-destructive">{describeError(detail.error)}</span>}
      </> : entry.kind === "version" ? <>
        {version}
        <span>{detail.branchKind === "iterate" ? "iteration started" : detail.branchKind === "fork" ? "forked" : "started"}</span>
        {detail.changePrompt && <span className="muted whitespace-pre-wrap">“{detail.changePrompt}”</span>}
      </> : entry.kind === "edited" ? <details>
        <summary className="cursor-pointer">
          Edited {[detail.title && "title", detail.prompt && "brief", detail.settings?.length && `settings (${detail.settings.join(", ")})`].filter(Boolean).join(", ")}
        </summary>
        {detail.title && <p>Title: “{detail.title.from ?? "untitled"}” → “{detail.title.to ?? "untitled"}”</p>}
        {detail.prompt && <div className="grid gap-2 sm:grid-cols-2">
          <p className="whitespace-pre-wrap"><strong>Before</strong><br />{detail.prompt.from}</p>
          <p className="whitespace-pre-wrap"><strong>After</strong><br />{detail.prompt.to}</p>
        </div>}
      </details> : entry.kind === "references" ? <span>References updated ({detail.from} → {detail.to})</span>
        : <>{version}<span>{labels[entry.kind] ?? entry.kind}</span>{entry.kind === "created" && detail.title && <span className="muted">“{detail.title}”</span>}</>}
      {detail.backfilled && <span className="muted" title="Reconstructed from saved timestamps; earlier intermediate states were not recorded.">· reconstructed</span>}
    </li>;
  })}</ol>;
}
