import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MarkdownTextarea } from "@/components/markdown-textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/status";
import { request } from "@/lib/client";

export type DesignUpdate = {
  id: string;
  status: string;
  error: string | null;
  createdAt: string;
  prompt?: string;
  designVersion: number;
  resultVersion: number | null;
};

export function DesignConversation({
  projectId, version, updates, disabled, blockedReason, onQueued,
}: {
  projectId: string;
  version: number;
  updates: DesignUpdate[];
  disabled: boolean;
  blockedReason: string;
  onQueued: () => Promise<unknown>;
}) {
  const feed = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [updates[0]?.id, updates[0]?.status]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blocked = disabled || busy;
  async function send() {
    if (blocked || prompt.trim().length < 3) return;
    setBusy(true);
    setError("");
    try {
      await request(`projects/${projectId}/design-update`, {
        method: "POST", body: JSON.stringify({ prompt, version }),
      });
      setPrompt("");
      await onQueued();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not request a design revision");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="design-conversation">
      <div className="panel">
        <h3>Design chat</h3>
        <p className="muted">Describe what to change. AI prepares a new draft for your review and approval. Existing builds keep their design.</p>
      </div>
      <div ref={feed} className="studio-chat-feed" aria-label="Design conversation">
        {!updates.some((update) => update.prompt) && (
          <p className="conversation-empty">Ask for a different palette, proportions, materials, or more specific design rules.</p>
        )}
        {[...updates].reverse().filter((update) => update.prompt).map((update) => (
          <div className="design-chat-turn" key={update.id}>
            <article className="chat-message is-user">
              <small>You · design v{update.designVersion} · <time dateTime={update.createdAt}>{new Date(update.createdAt).toLocaleString()}</time></small>
              <p>{update.prompt}</p>
            </article>
            <article className="chat-message is-agent">
              <div className="chat-agent-head"><strong>Design revision</strong><StatusBadge status={update.status} /></div>
              <p>{update.resultVersion
                ? `Draft v${update.resultVersion} is saved in Revisions. Review the design before approving it.`
                : update.status === "failed" ? "The update failed. Your saved design is unchanged."
                : update.status === "cancelled" ? "The update was cancelled. Your saved design is unchanged."
                : "Your saved design stays available while this update is prepared."}</p>
              {update.error && update.status !== "cancelled" && <p>{update.error}</p>}
              {["failed", "cancelled"].includes(update.status) && (
                <Button variant="outline" disabled={blocked} onClick={() => setPrompt(update.prompt || "")}>Use prompt again</Button>
              )}
            </article>
          </div>
        ))}
      </div>
      <form className="studio-chat-compose" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Label htmlFor="design-change-prompt">Adjust the design reference</Label>
        <div className="studio-compose-box">
          <MarkdownTextarea id="design-change-prompt" value={prompt} maxLength={12000} disabled={blocked}
            placeholder="Use warmer stone and soften the edges…"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault(); void send();
              }
            }} />
          <div className="studio-compose-row">
            <Button type="submit" disabled={blocked || prompt.trim().length < 3}><Send size={15} />{busy ? "Queueing…" : "Send changes"}</Button>
            <Link to="/admin/queue">View queue</Link>
          </div>
        </div>
        <p className="studio-compose-source">{disabled ? blockedReason : `Uses saved design v${version} and its references. AI usage is paid and recorded in Activity. Ctrl or ⌘ + Enter sends.`}</p>
      </form>
    </Card>
  );
}
