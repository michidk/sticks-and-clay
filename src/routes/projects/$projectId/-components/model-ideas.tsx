import { GenerationDialog } from "./generation-dialog";
import { useState } from "react";
import { Check, LoaderCircle, Pencil, Play, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { json, request } from "@/lib/client";
import type { GenerationInput } from "@/lib/api-inputs";

export type ModelIdea = {
  id: string;
  input: GenerationInput;
  readyAt?: string | null;
};

export const ideaBrief = (idea: ModelIdea) => idea.input.prompt?.trim() || "AI proposes assets from the approved design.";
export const ideaSettings = (idea: ModelIdea, isGraphics: boolean) =>
  `${isGraphics ? `Canvas ${idea.input.imageSize} · ` : ""}${idea.input.judgeIterations} review rounds`
  + (isGraphics ? "" : idea.input.visualTargetMode === "skip" ? " · No visual mock" : " · Visual target approval")
  + (idea.input.spriteTarget ? ` · Sprites ${idea.input.spriteTarget.size}px` : "");

/** Start, mark ready, or discard an idea; the caller refreshes the project. */
export function useIdeaActions(projectId: string, onRefresh: () => Promise<unknown>) {
  const [pending, setPending] = useState<{ id: string; action: IdeaAction } | null>(null);
  const [error, setError] = useState("");
  async function act(idea: ModelIdea, action: IdeaAction) {
    if (pending) return;
    setPending({ id: idea.id, action });
    setError("");
    try {
      const base = `projects/${projectId}/ideas/${idea.id}`;
      if (action === "generate") await request(`${base}/generate`, json({}));
      else if (action === "discard") await request(base, { method: "DELETE" });
      else await request(`${base}/ready`, json({ ready: !idea.readyAt }));
      await onRefresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update this idea");
    } finally {
      setPending(null);
    }
  }
  return { pending, error, act };
}
type IdeaAction = "generate" | "discard" | "ready";

/** Saved briefs waiting to start, in their own tab before the collection. */
export function ModelIdeas({ projectId, designVersion, ideas, isGraphics, ready, onRefresh }: {
  projectId: string;
  designVersion: number;
  ideas: ModelIdea[];
  isGraphics: boolean;
  ready: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<ModelIdea | null>(null);
  const { pending, error, act } = useIdeaActions(projectId, onRefresh);
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
          <tr><th>Brief</th><th>Count</th><th>Settings</th><th><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          {ideas.map((idea) => {
            const brief = ideaBrief(idea);
            const starting = pending?.id === idea.id && pending.action === "generate";
            return <tr key={idea.id}>
              <td>
                <div className="idea-brief-cell">
                  <button type="button" className="idea-brief" title={brief} onClick={() => setEditing(idea)}>{brief.split("\n")[0]}</button>
                  {idea.readyAt && <StatusBadge tone="done">Ready</StatusBadge>}
                </div>
              </td>
              <td className="tabular-nums">{idea.input.count}</td>
              <td className="muted">{ideaSettings(idea, isGraphics)}</td>
              <td>
                <div className="flex justify-end gap-1">
                  <Button size="sm" disabled={!ready || pending !== null} onClick={() => act(idea, "generate")}>
                    {starting ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}
                    {starting ? "Starting…" : "Start"}
                  </Button>
                  <Button size="sm" variant="outline" aria-pressed={!!idea.readyAt} disabled={pending !== null} onClick={() => act(idea, "ready")}>
                    <Check size={15} /> {idea.readyAt ? "Ready" : "Mark ready"}
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Edit idea" disabled={pending !== null} onClick={() => setEditing(idea)}>
                    <Pencil size={15} />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Discard idea" disabled={pending !== null} onClick={() => act(idea, "discard")}>
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
      open
      onOpenChange={(open) => { if (!open) setEditing(null); }}
      onRefresh={onRefresh}
      onSaved={async () => { await onRefresh(); }}
    />}
  </section>;
}
