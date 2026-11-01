import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AssetReferences } from "@/components/asset-references";
import { PictureUploader } from "@/components/picture-uploader";
import { useImageUpload } from "@/hooks/use-image-upload";
import { appendReferenceImages } from "@/lib/image-file";
import { request, json } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import type { Workspace } from "../-lib/model";

const conversationResult = z.object({ summary: z.string().optional() });

export function GraphicConversation({ projectId, modelId, sourceRunId, asset, runs, prompt, working, archived, designReady, onRefresh }: {
  projectId: string;
  modelId: string;
  sourceRunId?: string;
  asset: NonNullable<Workspace["assets"]>[number] | undefined;
  runs: Workspace["runs"];
  prompt: string;
  working: boolean;
  archived: boolean;
  designReady: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const uploader = useImageUpload();
  const [change, setChange] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const disabled = busy || working || archived || !designReady || !sourceRunId;
  async function send() {
    if (disabled || !sourceRunId || uploader.isBusy) return;
    setBusy(true);
    setError("");
    try {
      if (asset && uploader.images.length) {
        const existing = asset;
        const form = new FormData();
        appendReferenceImages(form, [
          ...existing.references.map((key) => ({ id: key, key, preview: "", name: "Saved reference" })),
          ...uploader.images,
        ]);
        form.set("referenceNotes", JSON.stringify(existing.referenceNotes));
        form.set("expected", JSON.stringify({ references: existing.references, referenceNotes: existing.referenceNotes }));
        await request(`projects/${projectId}/assets/${asset.id}/references`, { method: "POST", body: form });
        uploader.reset();
        await onRefresh();
      }
      const result = change.trim()
        ? await request<{ id: string }>(`asset-versions/${modelId}/branch`, json({ kind: "iterate", sourceRunId, prompt: change, judgeIterations: 2 }))
        : await request<{ id: string }>(`asset-versions/${modelId}/regenerate`, json({}));
      await navigate({ to: "/projects/$projectId/models/$modelId", params: { projectId, modelId: result.id }, search: { view: "3d", section: "review" } });
      await onRefresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not generate a version");
    } finally {
      setBusy(false);
    }
  }
  return <Card className="panel order-2 min-w-0 space-y-4 lg:order-1 lg:sticky lg:top-4" aria-label="Asset conversation">
    <h2>Conversation</h2>
    <div className="max-h-80 space-y-3 overflow-y-auto" aria-label="Version conversation">
      <div className="chat-message is-user"><p className="whitespace-pre-wrap">{prompt}</p></div>
      {runs.filter((run) => run.status === "done").map((run) => {
        const result = conversationResult.safeParse(run.result);
        return result.success && result.data.summary ? <div key={run.id} className="chat-message is-agent">
          <small>{run.role.endsWith("-judge") ? "Review" : "Build"}</small>
          <p>{result.data.summary}</p>
        </div> : null;
      })}
    </div>
    {!archived && asset && <details>
      <summary className="cursor-pointer">Saved asset references</summary>
      <AssetReferences projectId={projectId} assetId={asset.id} references={asset.references}
        referenceNotes={asset.referenceNotes} onRefresh={onRefresh} />
    </details>}
    {!archived && <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {asset && <PictureUploader title="New mockups or references" images={uploader.images}
        onFilesAdded={uploader.addFiles} onImportFromUrl={uploader.importFromUrl} onRemove={uploader.remove}
        disabled={disabled} isBusy={uploader.isBusy} />}
      <Label htmlFor="continuation-prompt">What should change?</Label>
      <Textarea id="continuation-prompt" value={change} onChange={(event) => setChange(event.target.value)}
        disabled={disabled} rows={4} maxLength={12000} minLength={change.trim() ? 3 : undefined}
        placeholder="Describe the changes and how to use your mockups…" />
      <p className="muted">New mockups are saved as asset references before generation. The current version is kept. Leave the message blank to regenerate using the approved design and latest saved result. Paid generation request.</p>
      {!designReady && <p className="muted">Approve the design before generating a new version.</p>}
      {working && <p role="status">Generation is in progress.</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button disabled={disabled || uploader.isBusy}>{busy ? "Queuing…" : "Generate version"}</Button>
    </form>}
  </Card>;
}
