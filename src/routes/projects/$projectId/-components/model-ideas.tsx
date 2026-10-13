import { GenerationDialog } from "./generation-dialog";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LoaderCircle, Pencil, Play, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { json, request } from "@/lib/client";
import type { GenerationInput } from "@/lib/api-inputs";

export type ModelIdea = {
  id: string;
  input: GenerationInput;
};

/** Saved briefs waiting to start, shown above the collection they will join. */
export function ModelIdeas({ projectId, designVersion, ideas, isGraphics, ready, onRefresh }: {
  projectId: string;
  designVersion: number;
  ideas: ModelIdea[];
  isGraphics: boolean;
  ready: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<ModelIdea | null>(null);
  const [pending, setPending] = useState<{ id: string; action: "generate" | "discard" } | null>(null);
  const [error, setError] = useState("");
  const noun = isGraphics ? "graphic" : "model";
  async function act(id: string, action: "generate" | "discard") {
    if (pending) return;
    setPending({ id, action });
    setError("");
    try {
      await request(`projects/${projectId}/ideas/${id}${action === "generate" ? "/generate" : ""}`,
        action === "generate" ? json({}) : { method: "DELETE" });
      await onRefresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update this idea");
    } finally {
      setPending(null);
    }
  }
  if (!ideas.length) return null;
  return <section className="idea-section" aria-label={`Saved ${noun} ideas`}>
    <div className="section-title flex-wrap gap-3">
      <div>
        <h2>Saved ideas <Badge variant="secondary" className="count">{ideas.length}</Badge></h2>
        <p className="muted">
          {ready
            ? "Start an idea to queue paid generation from the approved design."
            : "Approve the design before starting these ideas."}
        </p>
      </div>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="model-grid idea-grid">
      {ideas.map((idea) => <Card key={idea.id} className="idea-card min-w-0 gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3>{idea.input.count} {noun}{idea.input.count === 1 ? "" : "s"}</h3>
          <Badge variant="secondary">Not started</Badge>
        </div>
        <div className="markdown max-h-72 overflow-auto break-words text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {idea.input.prompt || "AI proposes assets from the approved design."}
          </ReactMarkdown>
        </div>
        <p className="muted text-xs">
          {isGraphics ? `Canvas ${idea.input.imageSize}` : `${idea.input.judgeIterations} review rounds per stage`}
          {idea.input.spriteTarget && ` · Sprite delivery, ${idea.input.spriteTarget.size}px, ${idea.input.spriteTarget.frameCount} frames`}
        </p>
        <div className="mt-auto flex flex-wrap gap-2">
          <Button disabled={!ready || pending !== null} onClick={() => act(idea.id, "generate")}>
            {pending?.id === idea.id && pending.action === "generate" ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}
            {pending?.id === idea.id && pending.action === "generate" ? "Starting…" : "Start generation"}
          </Button>
          <Button variant="outline" disabled={pending !== null} onClick={() => setEditing(idea)}>
            <Pencil size={16} /> Edit
          </Button>
          <Button variant="ghost" disabled={pending !== null} onClick={() => act(idea.id, "discard")}>
            <Trash2 size={16} /> Discard
          </Button>
        </div>
      </Card>)}
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
