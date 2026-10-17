import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MarkdownTextarea } from "@/components/markdown-textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLightbox } from "@/components/image-lightbox";
import { AssetImage } from "@/components/asset-image";
import { fileUrl, json, request } from "@/lib/client";

export function VisualTargetReview({ modelId, target, onRefresh }: {
  modelId: string;
  target: string;
  onRefresh: () => Promise<unknown>;
}) {
  const openLightbox = useLightbox();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(action: "approve" | "revise") {
    setBusy(true);
    setError("");
    try {
      await request(`models/${modelId}/visual-target`, json({ action, target, ...(action === "revise" ? { prompt: feedback } : {}) }));
      await onRefresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save your decision");
    } finally { setBusy(false); }
  }
  return <Card className="visual-target-review shrink-0 space-y-3 p-4" aria-label="Review visual target">
    <h2 className="font-medium">Approve the visual target</h2>
    <p className="muted">Building starts only after you approve this image. You can request changes first.</p>
    <button type="button" className="block w-full" aria-label="Inspect visual target"
      onClick={() => openLightbox([{ src: fileUrl(target), title: "Visual target", caption: "Awaiting your approval" }])}>
      <AssetImage src={fileUrl(target)} alt="Visual target awaiting your approval" className="w-full rounded-md" />
    </button>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Button disabled={busy} onClick={() => void decide("approve")}>Approve &amp; build</Button>
    <div className="space-y-2">
      <Label htmlFor="visual-target-feedback">Changes to the visual target</Label>
      <MarkdownTextarea id="visual-target-feedback" value={feedback} disabled={busy} maxLength={12000}
        onChange={(event) => setFeedback(event.target.value)} placeholder="Describe what to change…" />
      <Button variant="outline" disabled={busy || feedback.trim().length < 3} onClick={() => void decide("revise")}>Revise visual target</Button>
      <p className="muted">Generates a new image for your approval. Uses paid image generation.</p>
    </div>
  </Card>;
}
