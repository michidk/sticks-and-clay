import { describeError } from "@/lib/error-message";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { request, json, fileUrl } from "@/lib/client";
import type { Artifacts, Review } from "../-lib/model";
import { SpriteExport } from "./sprite-export";
import { AssetImage } from "@/components/asset-image";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function VersionActions({
  projectId,
  modelId,
  sourceRunId,
  artifacts,
  review,
  archived = false,
  judgeIterations,
}: {
  projectId: string;
  modelId: string;
  sourceRunId?: string;
  artifacts?: Artifacts;
  review?: Review;
  archived?: boolean;
  judgeIterations: number;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [jobId, setJobId] = useState<string>(),
    [job, setJob] = useState<any>();
  const [selected, setSelected] = useState<number[]>([]),
    navigate = useNavigate();
  const [variationOpen, setVariationOpen] = useState(false),
    [variationContext, setVariationContext] = useState("");
  const findings = [
    ...(artifacts?.metrics?.readiness?.findings.map(
      (f) => `${f.object}: ${f.message}`,
    ) || []),
    ...(review?.improvements.map(
      (f) =>
        `${f.view || "Observed view"}: ${f.issue}. Correction: ${f.action}`,
    ) || []),
    ...(artifacts?.metrics?.styleReview?.warnings || []),
  ];
  useEffect(() => {
    setSelected([]);
    setJobId(undefined);
    setJob(undefined);
  }, [sourceRunId]);
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request(`workshop-jobs/${jobId}`);
        if (active) {
          setError("");
          setJob(next);
          if (!["done", "failed", "cancelled"].includes(next.status))
            timer = setTimeout(poll, 2500);
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          timer = setTimeout(poll, 2500);
        }
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [jobId]);
  async function render(sprites: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await request(
        `models/${modelId}/presentation`,
        json({ sourceRunId, sprites }),
      );
      setJobId(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revise(style = false) {
    setBusy(true);
    setError("");
    try {
      const result = await request(
        `models/${modelId}/branch`,
        json({
          kind: "iterate",
          sourceRunId,
          judgeIterations: 2,
          useCurrentStyle: style,
          prompt: style
            ? "Match the project's reference images and their notes; retain this asset's functional silhouette and preserve all working interfaces."
            : `Repair only these selected findings, then inspect the same locations. Preserve unrelated geometry and materials, including mirrored partners unless the repair requires both.\n${selected.map((i) => findings[i]).join("\n")}`,
        }),
      );
      await navigate({
        to: "/projects/$projectId/models/$modelId",
        params: { projectId, modelId: result.id },
        search: { view: "3d", section: "review" },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createVariation() {
    if (!sourceRunId) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string }>(
        `models/${modelId}/branch`,
        json({ kind: "fork", variation: true, sourceRunId, prompt: "Create a variation", variationContext, judgeIterations }),
      );
      setVariationOpen(false);
      setVariationContext("");
      await navigate({ to: "/projects/$projectId/models/$modelId", params: { projectId, modelId: result.id }, search: { view: "3d", section: "review" } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rendering =
    job && !["done", "failed", "cancelled"].includes(job.status);
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <h3>Version tools</h3>
      <p className="muted">
        Repairs create new versions. Presentation exports use the saved model
        without an agent.
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!sourceRunId || busy || rendering}
          onClick={() => void render(false)}
        >
          Render again
        </Button>
        <SpriteExport modelId={modelId} sourceRunId={sourceRunId} />
        <Button
          variant="outline"
          disabled={!sourceRunId || busy}
          onClick={() => void revise(true)}
        >
          Match references
        </Button>
        {!archived && <Button variant="outline" disabled={!sourceRunId || !artifacts?.renders?.length || busy} onClick={() => { setError(""); setVariationOpen(true); }}>
          Create variation
        </Button>}
      </div>
      <Dialog open={variationOpen} onOpenChange={(open) => !busy && setVariationOpen(open)}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Create a variation</DialogTitle>
            <DialogDescription>
              Creates a new asset using this model's prompt and the render below as a reference image. Starts paid generation with {judgeIterations} review rounds per stage and pauses for visual target approval.
            </DialogDescription>
          </DialogHeader>
          {artifacts?.renders[0] && <AssetImage src={fileUrl(artifacts.renders[0])} alt="Model render used as the variation reference" className="max-h-48 w-full object-contain" />}
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2">
            <Label htmlFor="variation-context">Variation context (optional)</Label>
            <Textarea id="variation-context" value={variationContext} onChange={(event) => setVariationContext(event.target.value)} maxLength={12000} placeholder="For example: make the handle shorter and use dark bronze." rows={4} />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setVariationOpen(false)}>Cancel</Button>
            <Button disabled={busy || !sourceRunId} onClick={() => void createVariation()}>{busy ? "Creating variation…" : "Create variation"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {job && (
        <div role="status">
          <p>
            {job.status === "done"
              ? "Presentation ready"
              : (job.error ? describeError(job.error) : "") || `Presentation: ${job.status}`}
          </p>
          {job.files?.map((key: string) => (
            <a
              key={key}
              className="mr-3 inline-block underline"
              href={fileUrl(key)}
              download
            >
              {key.split("/").pop()}
            </a>
          ))}
        </div>
      )}
      {!!findings.length && (
        <fieldset className="space-y-2">
          <legend>Select issues to repair</legend>
          {findings.map((f, i) => (
            <label key={i} className="workshop-issue">
              <input
                type="checkbox"
                className="workshop-checkbox"
                checked={selected.includes(i)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, i]
                      : selected.filter((n) => n !== i),
                  )
                }
              />
              <span>{f}</span>
            </label>
          ))}
          <Button
            disabled={!sourceRunId || busy || !selected.length}
            onClick={() => void revise()}
          >
            Fix selected issues
          </Button>
        </fieldset>
      )}
    </section>
  );
}
