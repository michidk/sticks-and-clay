import { GenerationDialog } from "./generation-dialog";
import { useState } from "react";
import { Check, LoaderCircle, Pencil, Play, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { json, request } from "@/lib/client";
import { usePending } from "@/hooks/use-pending";
import type { GenerationInput } from "@/lib/api-inputs";
import type { AssetType } from "@/lib/asset-types";

export type AssetDraft = {
  id: string;
  /** Null only on ideas saved before titles existed. */
  title?: string | null;
  input: GenerationInput;
  readyAt?: string | null;
  references?: string[];
  referenceNotes?: Record<string, string>;
  inIdea?: boolean;
};

export const ideaBrief = (idea: AssetDraft) => idea.input.prompt?.trim() || "AI proposes assets from the approved design.";
export const ideaTitle = (idea: AssetDraft) => idea.title?.trim() || ideaBrief(idea).split("\n")[0];
export const ideaSettings = (idea: AssetDraft, isGraphics: boolean, assetType?: AssetType) =>
  `${isGraphics && assetType !== "cad" ? `Canvas ${assetType === "svg" ? "square vector" : idea.input.resolution ? `${idea.input.resolution.width}×${idea.input.resolution.height}` : "project default"} · ` : ""}${idea.input.judgeIterations} review rounds`
  + (isGraphics ? "" : idea.input.visualTargetMode === "skip" ? " · No visual mock" : " · Visual target approval")
  + (idea.input.spriteTarget ? ` · Sprites ${idea.input.spriteTarget.size}px` : "");

/** Start, mark ready, or discard an idea; the caller refreshes the project.
 * Each idea's action is tracked on its own, so working on one never locks the others. */
export function useIdeaActions(projectId: string, onRefresh: () => Promise<unknown>) {
  const pending = usePending();
  const [error, setError] = useState("");
  const isPending = (idea: { id: string }, action: IdeaAction) => pending.has(`${idea.id}:${action}`);
  const act = (idea: AssetDraft, action: IdeaAction) => pending.run(`${idea.id}:${action}`, async () => {
    setError("");
    try {
      const base = `projects/${projectId}/assets/${idea.id}`;
      if (action === "generate") await request(`${base}/generate`, json({}));
      else if (action === "discard") await request(base, { method: "DELETE" });
      else await request(`${base}/ready`, json({ ready: !idea.readyAt }));
      await onRefresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update this asset");
    }
  });
  return { isPending, error, act };
}
type IdeaAction = "generate" | "discard" | "ready";

/** Saved briefs waiting to start, in their own tab before the collection. */
export function AssetDrafts({ projectId, designVersion, ideas, isGraphics, ready, onRefresh, assetType }: {
  assetType?: AssetType;
  projectId: string;
  designVersion: number;
  ideas: AssetDraft[];
  isGraphics: boolean;
  ready: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<AssetDraft | null>(null);
  const { isPending, error, act } = useIdeaActions(projectId, onRefresh);
  const noun = isGraphics ? "graphic" : "model";
  if (!ideas.length) return null;
  return <section className="idea-section" aria-label={`Saved ${noun} ideas`}>
    <p className="muted">
      {ready
        ? "Start an idea to queue paid generation from the approved design."
        : "Approve the design before starting these ideas."}
    </p>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="idea-table">
      <table>
        <thead>
          <tr><th>Asset</th><th>Settings</th><th><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          {ideas.map((idea) => {
            const brief = ideaBrief(idea);
            const starting = isPending(idea, "generate");
            return <tr key={idea.id}>
              <td>
                <div className="idea-brief-cell">
                  <div className="idea-text">
                    <button type="button" className="idea-brief" title={brief} onClick={() => setEditing(idea)}>{ideaTitle(idea)}</button>
                    {brief.split("\n")[0] !== ideaTitle(idea) && <span className="idea-excerpt">{brief.split("\n")[0]}</span>}
                  </div>
                  {idea.readyAt && <StatusBadge tone="done">Ready</StatusBadge>}
                </div>
              </td>
              <td className="muted">{ideaSettings(idea, isGraphics, assetType)}</td>
              <td>
                <div className="flex justify-end gap-1">
                  <Button size="sm" disabled={!ready || starting} onClick={() => act(idea, "generate")}>
                    {starting ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}
                    {starting ? "Starting…" : "Start"}
                  </Button>
                  <Button size="sm" variant="outline" aria-pressed={!!idea.readyAt} disabled={isPending(idea, "ready")} onClick={() => act(idea, "ready")}>
                    <Check size={15} /> {idea.readyAt ? "Ready" : "Mark ready"}
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Edit asset" onClick={() => setEditing(idea)}>
                    <Pencil size={15} />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Discard asset" disabled={isPending(idea, "discard")} onClick={() => act(idea, "discard")}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    {editing && <GenerationDialog
      key={editing.id}
      idea={editing}
      projectId={projectId}
      designVersion={designVersion}
      ready={ready}
      isGraphics={isGraphics}
      assetType={assetType}
      open
      onOpenChange={(open) => { if (!open) setEditing(null); }}
      onRefresh={onRefresh}
      onSaved={async () => { await onRefresh(); }}
    />}
  </section>;
}
