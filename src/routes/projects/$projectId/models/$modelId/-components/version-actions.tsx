import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { request, json, fileUrl } from "@/lib/client";
import type { Artifacts, Review } from "../-lib/model";
import { SpriteExport } from "./sprite-export";

export function VersionActions({
  projectId,
  modelId,
  sourceRunId,
  artifacts,
  review,
}: {
  projectId: string;
  modelId: string;
  sourceRunId?: string;
  artifacts?: Artifacts;
  review?: Review;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [jobId, setJobId] = useState<string>(),
    [job, setJob] = useState<any>();
  const [selected, setSelected] = useState<number[]>([]),
    navigate = useNavigate();
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
          setJob(next);
          if (!["done", "failed", "cancelled"].includes(next.status))
            timer = setTimeout(poll, 2500);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
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
            ? "Match the current collection style and selected prototypes; retain this asset's functional silhouette and preserve all working interfaces."
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
          Match collection style
        </Button>
      </div>
      {job && (
        <div role="status">
          <p>
            {job.status === "done"
              ? "Presentation ready"
              : job.error || `Presentation: ${job.status}`}
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
