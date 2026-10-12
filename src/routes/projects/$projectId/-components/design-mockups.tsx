import { useState, type FormEvent } from "react";
import { ArrowRight, Download, ImagePlus, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AssetImage } from "@/components/asset-image";
import { useLightbox } from "@/components/image-lightbox";
import { Progress } from "@/components/progress";
import { agentStateFromStatus } from "@/components/agent-state";
import { fileUrl, json, request } from "@/lib/client";
import type { DesignMockups } from "@/lib/design-mockups";

export function DesignMockupStep({
  projectId, version, mockups, isGraphics, onRefresh, onGenerate,
}: {
  projectId: string;
  version: number;
  mockups: DesignMockups[];
  isGraphics: boolean;
  onRefresh: () => Promise<unknown>;
  onGenerate: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const openLightbox = useLightbox();
  const active = mockups.some((job) => ["queued", "running", "cancelling"].includes(job.status));
  const hasImages = mockups.some((job) => job.images.length > 0);
  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || active) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await request(`projects/${projectId}/mockups`, json({
        version,
        count: Number(form.get("count")),
        hint: form.get("hint"),
      }));
      await onRefresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string) {
    setBusy(true);
    setError("");
    try {
      await request(path, json({}));
      await onRefresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <Card className="panel">
        <div className="section-title flex-wrap gap-4">
          <div>
            <div className="eyebrow">STEP 2 · OPTIONAL</div>
            <h2>Preview your design with mockups</h2>
          </div>
          <Button variant="outline" onClick={onGenerate}>
            {hasImages ? "Continue to ideas" : "Skip and add ideas"}
            <ArrowRight size={16} />
          </Button>
        </div>
        <p className="muted">
          Generate concept images from approved design v{version} and its visual references
          with the ChatGPT Image API. You can start generating {isGraphics ? "graphics" : "3D assets"} at any time.
        </p>
        <form onSubmit={generate} className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="mockup-count">Number of mockups</Label>
              <Input id="mockup-count" name="count" type="number" min={1} max={4}
                defaultValue={3} required disabled={busy || active} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mockup-hint">What should the mockups show? (optional)</Label>
              <Textarea id="mockup-hint" name="hint" maxLength={12000} rows={3}
                placeholder="Describe a few examples, or let the design guide the images."
                disabled={busy || active} />
            </div>
          </div>
          <p className="note">
            Mockups are concept previews. They do not change the approved design or
            reference images. Image generation is paid; usage is recorded in Activity &amp; cost.
          </p>
          <Button disabled={busy || active}>
            {busy || active ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />}
            {busy ? "Queueing mockups…" : active ? "Mockups in progress" : "Generate mockups"}
          </Button>
        </form>
        {error && <Alert variant="destructive" role="alert" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>}
      </Card>
      {mockups.map((job) => {
        const running = ["queued", "running", "cancelling"].includes(job.status);
        const gallery = job.images.map((image, index) => ({
          src: fileUrl(image.key),
          title: `Design v${job.version} · Mockup ${index + 1}`,
          caption: "Concept preview from the approved design",
        }));
        return <Card key={job.id} className="panel">
          <div className="section-title flex-wrap gap-3">
            <h3>Design v{job.version} · {job.images.length} / {job.count} mockups</h3>
            <div>
              <Badge variant="secondary" className={`badge ${job.status}`}>
                {job.status === "done" ? "Completed" : job.status}
              </Badge>
            </div>
          </div>
          {job.version !== version && <p className="note">From an earlier approved design.</p>}
          {running && <Progress value={Math.round(job.images.length / job.count * 100)}
            label={job.status === "queued" ? "Waiting to generate mockups" : job.status === "cancelling" ? "Stopping mockups" : `Generating mockup ${Math.min(job.images.length + 1, job.count)} of ${job.count}`}
            agentState={agentStateFromStatus(job.status)} />}
          {job.error && <Alert variant="destructive" className="my-4">
            <AlertDescription>{job.error}</AlertDescription>
          </Alert>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {job.images.map((image, index) => <figure key={image.runId}>
              <button type="button" className="block w-full overflow-hidden rounded-lg border"
                aria-label={`Inspect design v${job.version} mockup ${index + 1}`}
                onClick={() => openLightbox(gallery, index)}>
                <AssetImage src={fileUrl(image.key)} alt={gallery[index].title}
                  className="aspect-[3/2] w-full" style={{ objectFit: "contain" }} />
              </button>
              <figcaption className="mt-2 flex items-center justify-between text-sm">
                <span>Mockup {index + 1}</span>
                <Button asChild variant="ghost" size="sm">
                  <a href={fileUrl(image.key)} download><Download size={14} /> PNG</a>
                </Button>
              </figcaption>
            </figure>)}
          </div>
          {(running || job.status === "failed") && <div className="mt-4">
            <Button variant="outline" disabled={busy || job.status === "cancelling" || (job.status === "failed" && active)}
              onClick={() => action(`queue/${job.id}/${job.status === "failed" ? "resume" : "cancel"}`)}>
              {job.status === "failed" ? "Resume mockups" : job.status === "queued" ? "Cancel mockups" : "Stop mockups"}
            </Button>
          </div>}
        </Card>;
      })}
    </div>
  );
}
