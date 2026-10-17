import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { diffLines } from "diff";
import { Check, ImagePlus, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MarkdownTextarea } from "@/components/markdown-textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/status";
import { describeError } from "@/lib/error-message";
import { json, request } from "@/lib/client";

export type DesignUpdate = {
  id: string;
  status: string;
  error: string | null;
  createdAt: string;
  prompt?: string;
  designVersion: number;
  resultVersion: number | null;
};

export type DesignRevision = {
  id: string;
  version: number;
  content: string;
  author: string;
  approved: boolean;
  createdAt: string;
};

const IMPROVE_PROMPT =
  "Improve this design reference. Make it more specific, complete and consistent: resolve ambiguities, add missing rules and fix contradictions. Keep the owner's intent, names and every explicit requirement.";

const authorLabel = (author: string) =>
  author === "user" ? "You" : author === "model" ? "Model render" : "AI designer";

/** The design's history as a chat: each revision is a message you can revert to, and AI drafts need an explicit accept or discard. */
export function DesignConversation({
  project, revisions, updates, locked, blockedReason, onChanged, onOpenMockups,
}: {
  project: { id: string; designVersion: number; status: string };
  revisions: DesignRevision[];
  updates: DesignUpdate[];
  /** Unsaved edits, a running update or a stale document: history actions must wait. */
  locked: boolean;
  blockedReason: string;
  onChanged: () => Promise<unknown>;
  onOpenMockups: () => void;
}) {
  const version = project.designVersion;
  const ready = project.status === "ready";
  const feed = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const timeline = [
    ...revisions.map((revision) => ({
      kind: "revision" as const,
      revision,
      update: updates.find((update) => update.resultVersion === revision.version),
      at: +new Date(revision.createdAt),
    })),
    ...updates.filter((update) => !update.resultVersion).map((update) => ({
      kind: "update" as const, update, at: +new Date(update.createdAt),
    })),
  ].sort((a, b) => a.at - b.at);
  useEffect(() => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [timeline.length, updates[0]?.status, version]);
  const current = revisions.find((revision) => revision.version === version);
  const aiDraft = project.status === "review" && current && current.author !== "user";
  const discardTarget = aiDraft
    ? [...revisions].filter((revision) => revision.version < version).sort((a, b) => b.version - a.version)
        .find((revision) => revision.approved) ?? revisions.find((revision) => revision.version === version - 1)
    : undefined;
  const blocked = locked || Boolean(busy);

  async function run(name: string, action: () => Promise<unknown>, after?: () => void) {
    if (blocked) return;
    setBusy(name);
    setError("");
    try {
      await action();
      after?.();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const sendChange = (text: string, name = "send") =>
    run(name, () => request(`projects/${project.id}/design-update`, json({ prompt: text, version })),
      () => setPrompt(""));
  const revert = (toVersion: number, name: string) =>
    run(name, () => request(`projects/${project.id}/design/revert`, json({ version, toVersion })));

  return (
    <section className="design-chat-panel" aria-label="Design chat">
      <div className="studio-chat-head">
        <h3>Design chat</h3>
        <p className="muted">
          Every revision is a message. Revert to any version; AI drafts stay pending until you accept or discard them. Existing builds keep their design.
        </p>
      </div>
      <div ref={feed} className="studio-chat-feed" aria-label="Design history">
        {timeline.map((item) => item.kind === "update" ? (
          <div className="design-chat-turn" key={item.update.id}>
            {item.update.prompt && (
              <article className="chat-message is-user">
                <small>You · design v{item.update.designVersion}</small>
                <p>{item.update.prompt}</p>
              </article>
            )}
            <article className={`chat-message is-agent ${item.update.status === "failed" ? "is-failed" : ["queued", "running"].includes(item.update.status) ? "is-running" : ""}`}>
              <div className="chat-agent-head"><strong>Design revision</strong><StatusBadge status={item.update.status} /></div>
              <p>{item.update.status === "failed" ? "The update failed. Your saved design is unchanged."
                : item.update.status === "cancelled" ? "The update was cancelled. Your saved design is unchanged."
                : "Your saved design stays available while this update is prepared."}</p>
              {item.update.error && item.update.status !== "cancelled" && <p>{describeError(item.update.error)}</p>}
              {["failed", "cancelled"].includes(item.update.status) && (
                <div className="chat-message-actions">
                  {item.update.prompt && (
                    <Button size="sm" disabled={blocked} onClick={() => void sendChange(item.update.prompt!, `retry-${item.update.id}`)}>
                      <RotateCcw size={14} /> {busy === `retry-${item.update.id}` ? "Retrying…" : "Try again"}
                    </Button>
                  )}
                  {item.update.prompt && <Button size="sm" variant="outline" disabled={blocked} onClick={() => setPrompt(item.update.prompt!)}>Edit prompt</Button>}
                  {/usage limit/i.test(describeError(item.update.error)) && (
                    <Button size="sm" variant="outline" asChild><Link to="/admin/settings">Open settings</Link></Button>
                  )}
                </div>
              )}
            </article>
          </div>
        ) : (
          <div className="design-chat-turn" key={item.revision.id}>
            {item.update?.prompt && (
              <article className="chat-message is-user">
                <small>You · <time dateTime={item.update.createdAt}>{new Date(item.update.createdAt).toLocaleString()}</time></small>
                <p>{item.update.prompt}</p>
              </article>
            )}
            <RevisionMessage
              revision={item.revision}
              current={item.revision.version === version}
              ready={ready}
              pending={item.revision.version === version && project.status === "review"}
              ai={item.revision.author !== "user"}
              initial={item.revision.version === 1 && item.revision.author === "user"}
              currentContent={current?.content ?? ""}
              blocked={blocked}
              busy={busy}
              canDiscard={Boolean(discardTarget)}
              onRevert={() => revert(item.revision.version, `revert-${item.revision.version}`)}
              onAccept={() => run("accept", () => request(`projects/${project.id}/design/approve`, json({ version })))}
              onDiscard={() => discardTarget && revert(discardTarget.version, "discard")}
            />
          </div>
        ))}
        {!timeline.length && <p className="conversation-empty">The design history appears here.</p>}
      </div>
      <form className="studio-chat-compose" onSubmit={(event) => { event.preventDefault(); if (prompt.trim().length >= 3) void sendChange(prompt); }}>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Label htmlFor="design-change-prompt">Change the design reference</Label>
        <div className="studio-compose-box">
          <MarkdownTextarea id="design-change-prompt" value={prompt} maxLength={12000} disabled={locked}
            placeholder="Use warmer stone and soften the edges…"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                if (prompt.trim().length >= 3) void sendChange(prompt);
              }
            }} />
          <div className="studio-compose-row design-compose-actions">
            <Button type="submit" disabled={blocked || prompt.trim().length < 3}>
              <Send size={15} />{busy === "send" ? "Queueing…" : "Change"}
            </Button>
            <Button type="button" variant="outline" disabled={blocked || !current} onClick={() => void sendChange(IMPROVE_PROMPT, "improve")}>
              <Sparkles size={15} />{busy === "improve" ? "Queueing…" : "Improve"}
            </Button>
            <Button type="button" variant="outline" disabled={!ready} onClick={onOpenMockups}>
              <ImagePlus size={15} /> Mockups
            </Button>
          </div>
        </div>
        <p className="studio-compose-source">
          {locked ? blockedReason : ready
            ? `Change applies your request, Improve lets AI tighten the whole design, Mockups generates concept images. Uses saved design v${version}; AI usage is paid and recorded in Activity. Ctrl or ⌘ + Enter sends.`
            : `Approve the design to generate mockups. Change and Improve use saved design v${version}; AI usage is paid and recorded in Activity.`}
        </p>
      </form>
    </section>
  );
}

function RevisionMessage({
  revision, current, ready, pending, ai, initial, currentContent, blocked, busy, canDiscard, onRevert, onAccept, onDiscard,
}: {
  revision: DesignRevision;
  current: boolean;
  ready: boolean;
  pending: boolean;
  ai: boolean;
  initial: boolean;
  currentContent: string;
  blocked: boolean;
  busy: string;
  canDiscard: boolean;
  onRevert: () => void;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  return (
    <article className={`chat-message is-agent ${pending ? "is-warning" : ""}`}>
      <div className="chat-agent-head">
        <strong>{initial ? "Brief as design v1" : `Design v${revision.version}`}</strong>
        <span className="chat-agent-state">
          {authorLabel(revision.author)}
          {current ? (ready ? " · approved, current" : " · current, awaiting approval") : revision.approved ? " · approved" : ""}
        </span>
      </div>
      {pending && (
        <p>{ai ? "AI prepared this draft. Accept it to approve it for generation, or discard it to return to the previous version."
          : initial ? "Your brief, exactly as you wrote it. Approve it, or improve or change it first."
          : "Saved as a draft. Approve it to enable generation."}</p>
      )}
      <div className="chat-message-actions">
        {pending && (
          <Button size="sm" disabled={blocked} onClick={onAccept}>
            <Check size={14} /> {busy === "accept" ? "Saving…" : ai ? "Accept" : "Approve"}
          </Button>
        )}
        {pending && ai && canDiscard && (
          <Button size="sm" variant="outline" disabled={blocked} onClick={onDiscard}>
            <X size={14} /> {busy === "discard" ? "Reverting…" : "Discard"}
          </Button>
        )}
        {!current && (
          <Button size="sm" variant="outline" disabled={blocked} onClick={onRevert}>
            <RotateCcw size={14} /> {busy === `revert-${revision.version}` ? "Reverting…" : "Revert to this"}
          </Button>
        )}
      </div>
      {!current && (
        <details className="design-revision-diff">
          <summary>Compare with current</summary>
          <pre className="revision-diff">
            {diffLines(revision.content, currentContent).map((part, index) => (
              <span key={index} className={part.added ? "diff-added" : part.removed ? "diff-removed" : ""}>{part.value}</span>
            ))}
          </pre>
          <small>Green: in the current version. Red: only in this version.</small>
        </details>
      )}
    </article>
  );
}
