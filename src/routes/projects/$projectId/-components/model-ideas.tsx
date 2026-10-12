import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { LoaderCircle, Play, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { json, request } from "@/lib/client";
import type { GenerationInput } from "@/lib/api-inputs";

export type ModelIdea = {
  id: string;
  input: GenerationInput;
};

export function ModelIdeas({ projectId, ideas, isGraphics, ready, onAdd, onRefresh, onGenerated }: {
  projectId: string;
  ideas: ModelIdea[];
  isGraphics: boolean;
  ready: boolean;
  onAdd: () => void;
  onRefresh: () => Promise<unknown>;
  onGenerated: () => void;
}) {
  const [pending, setPending] = useState<{ id: string; action: "generate" | "discard" } | null>(null);
  const [error, setError] = useState("");
  const plural = isGraphics ? "Graphic" : "Model";
  async function act(id: string, action: "generate" | "discard") {
    if (pending) return;
    setPending({ id, action });
    setError("");
    try {
      await request(`projects/${projectId}/ideas/${id}${action === "generate" ? "/generate" : ""}`,
        action === "generate" ? json({}) : { method: "DELETE" });
      await onRefresh();
      if (action === "generate") onGenerated();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update this idea");
    } finally {
      setPending(null);
    }
  }
  return <section className="space-y-5" aria-label={`${plural} ideas`}>
    <div className="section-title flex-wrap gap-3">
      <div>
        <h2>Ideas</h2>
        <p className="muted">Saved briefs. Starting one queues paid generation from the approved design at that time.</p>
      </div>
      <Button onClick={onAdd}><Plus size={17} /> Add ideas</Button>
    </div>
    {!ready && <p className="note">Approve the design reference before starting generation.</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {!ideas.length ? <Empty>
      <h3>No ideas saved yet</h3>
      <p>Add a brief, or draft one with AI, and start it when ready.</p>
      <Button variant="outline" onClick={onAdd}><Plus size={17} /> Add ideas</Button>
    </Empty> : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {ideas.map((idea) => <Card key={idea.id} className="min-w-0 gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3>{idea.input.count} {isGraphics ? "graphic" : "model"}{idea.input.count === 1 ? "" : "s"}</h3>
          <Badge variant="secondary">Idea</Badge>
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
          <Button variant="outline" disabled={pending !== null} onClick={() => act(idea.id, "discard")}>
            <Trash2 size={16} /> Discard
          </Button>
        </div>
      </Card>)}
    </div>}
  </section>;
}
