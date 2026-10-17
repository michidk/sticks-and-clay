import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Download, LoaderCircle } from "lucide-react";
import { AssetImage } from "@/components/asset-image";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { LightboxProvider, useLightbox } from "@/components/image-lightbox";
import { StatusBadge } from "@/components/status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { costSummary, fileUrl, json, request } from "@/lib/client";
import { describeError } from "@/lib/error-message";
import { isFlatRole } from "@/lib/asset-types";
import { DeleteAsset } from "../../../-components/delete-asset";
import { ReturnToIdea } from "../../../-components/return-to-idea";
import { GraphicVariant } from "../../../-components/graphic-variant";
import type { Workspace } from "../-lib/model";

type Review = { score?: number; passed?: boolean; summary?: string; improvements?: { priority: string; issue: string }[] };

/** One generated graphic or SVG: the image large, its versions, the review, and the actions on it. */
export function GraphicDetail({
  data, projectId, modelId, reload,
}: {
  data: Workspace;
  projectId: string;
  modelId: string;
  reload: () => Promise<unknown>;
}) {
  return (
    <LightboxProvider>
      <GraphicDetailContent data={data} projectId={projectId} modelId={modelId} reload={reload} />
    </LightboxProvider>
  );
}

function GraphicDetailContent({ data, projectId, modelId, reload }: {
  data: Workspace; projectId: string; modelId: string; reload: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const openLightbox = useLightbox();
  const [picked, setPicked] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const model: any = data.models.find((item) => item.id === modelId);
  const back = (
    <Breadcrumbs items={[
      { label: "Projects", link: { to: "/" } },
      { label: data.project.name, link: { to: "/projects/$projectId", params: { projectId } } },
    ]} />
  );
  if (!model)
    return (
      <main className="model-detail-page">
        {back}
        <div className="model-detail-empty"><h1>Graphic not found</h1><p>It is not part of this project, or it was deleted.</p></div>
      </main>
    );
  const name = model.name.replaceAll("_", " ");
  const runs = data.runs.filter((run) => run.modelId === modelId);
  const builds = runs
    .filter((run: any) => isFlatRole(run.role) && run.status === "done" && run.result?.key)
    .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const reviewOf = (build: any): Review | undefined =>
    (runs.find((run: any) => run.role.endsWith("-judge") && run.status === "done" && run.iteration === build.iteration
      && new Date(run.createdAt) >= new Date(build.createdAt)) as any)?.result;
  const current = builds.find((build) => build.id === picked) ?? builds.at(-1);
  const currentKey = (current?.result as { key?: string } | undefined)?.key ?? model.artifacts?.image;
  const review: Review | undefined = current ? reviewOf(current) : model.feedback;
  const batch = (data.batches as any[]).find((item) => item.id === model.batchId);
  const outdated = !!batch && batch.designVersion < data.project.designVersion;
  const archived = Boolean(data.project.archivedAt);
  const working = !["done", "failed", "cancelled"].includes(model.status);
  const cost = runs.reduce((sum, run) => sum + (run.estimatedCost || 0), 0);
  const format = (key?: string) => (key?.endsWith(".svg") ? "SVG" : "PNG");
  const pixelated = data.project.assetType === "pixel";
  const gallery = builds.map((build: any, index) => ({
    pixelated, src: fileUrl(build.result.key), title: `${name} · version ${index + 1}`, caption: reviewOf(build)?.summary,
  }));

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="model-detail-page">
      {back}
      <section className="page-header">
        <div>
          <h1>{name}</h1>
          <div className="page-meta">
            <StatusBadge status={model.status} verdict={model.verdict === "limit_reached" ? model.verdict : undefined} />
            {batch && <StatusBadge tone={outdated ? "warning" : "queued"}>Design v{batch.designVersion}{outdated ? " · outdated" : ""}</StatusBadge>}
            {currentKey && <span>{format(currentKey)}</span>}
            <span>{costSummary(cost)} spent</span>
          </div>
        </div>
        <div className="page-actions">
          {currentKey && (
            <Button variant="outline" asChild>
              <a href={fileUrl(currentKey)} download><Download size={14} /> {format(currentKey)}</a>
            </Button>
          )}
          {current && <GraphicVariant model={model} sourceRunId={current.id} onSaved={reload} />}
          {outdated && !archived && !working && builds.length > 0 && (
            <Button variant="outline" disabled={busy}
              onClick={() => void act(async () => {
                await request(`models/${modelId}/regenerate`, json({}));
                void navigate({ to: "/projects/$projectId", params: { projectId } });
              })}>
              Regenerate on v{data.project.designVersion}
            </Button>
          )}
          {!archived && (
            <ReturnToIdea id={modelId} name={name} noun="graphic" canDelete={!working}
              onDone={() => navigate({ to: "/projects/$projectId", params: { projectId }, search: { tab: "ideas" } })} />
          )}
          {!archived && (
            <DeleteAsset id={modelId} name={name} disabled={working}
              onDeleted={() => navigate({ to: "/projects/$projectId", params: { projectId } })} />
          )}
        </div>
      </section>
      {(error || model.error) && (
        <Alert variant="destructive" role="alert" className="error">
          <AlertDescription>{error || describeError(model.error)}</AlertDescription>
        </Alert>
      )}
      {model.status === "failed" && (
        <Button variant="outline" disabled={busy} onClick={() => void act(() => request(`models/${modelId}/retry`, json({})))}>
          {busy && <LoaderCircle className="spin" size={16} />} Resume
        </Button>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="panel">
          {currentKey ? (
            <button type="button" aria-label="Open full size" className="block w-full"
              onClick={() => openLightbox(gallery, Math.max(0, builds.findIndex((build) => build.id === current?.id)))}>
              <AssetImage src={fileUrl(currentKey)} width={1280} pixelated={pixelated} alt={name}
                className="mx-auto aspect-square w-full max-w-[640px] rounded-lg bg-white" style={{ objectFit: "contain" }} />
            </button>
          ) : (
            <p className="muted">{working ? "Generating. The image appears here when it is ready." : "No image was saved for this graphic."}</p>
          )}
          {builds.length > 1 && (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Versions">
              {builds.map((build: any, index) => (
                <li key={build.id}>
                  <button type="button" aria-pressed={build.id === current?.id} aria-label={`Version ${index + 1}`}
                    className="block size-20 overflow-hidden rounded-md border bg-white aria-pressed:ring-2 aria-pressed:ring-primary"
                    onClick={() => setPicked(build.id)}>
                    <AssetImage src={fileUrl(build.result.key)} width={320} pixelated={pixelated} alt="" className="size-full" style={{ objectFit: "contain" }} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card className="panel">
            <h2>Review</h2>
            {review?.summary ? (
              <>
                <p><strong>{review.score}/100</strong> · {review.passed ? "Passed" : "Changes requested"}</p>
                <p>{review.summary}</p>
                {!!review.improvements?.length && (
                  <ul className="list-disc pl-5">
                    {review.improvements.map((item, index) => <li key={index}>[{item.priority}] {item.issue}</li>)}
                  </ul>
                )}
              </>
            ) : (
              <p className="muted">{working ? "The review appears when the first version is judged." : "This version was not reviewed."}</p>
            )}
          </Card>
          <Card className="panel">
            <h2>Prompt</h2>
            <p className="whitespace-pre-wrap">{model.prompt}</p>
          </Card>
        </div>
      </div>
    </main>
  );
}
