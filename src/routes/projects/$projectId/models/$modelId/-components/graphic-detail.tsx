import { VisualTargetReview } from "./visual-target-review";
import { RenameButton } from "@/components/rename";
import { BuildTrace } from "./build-trace";
import { useState } from "react";
import { z } from "zod";
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
import { ReopenAsIdea } from "../../../-components/reopen-as-idea";
import { GraphicVariant } from "../../../-components/graphic-variant";
import { PixelExports } from "./pixel-exports";
import { PixelEditor } from "./pixel-editor";
import { CadExports } from "./cad-exports";
import { GraphicConversation } from "./graphic-conversation";
import { ReviewNotes } from "./review";
import type { Review, Workspace } from "../-lib/model";

const svgPreviews = z.object({ previews: z.array(z.object({ key: z.string(), label: z.string() })) });

const namedParts = z.array(z.object({ name: z.string(), key: z.string() }));

/** One generated graphic or SVG: the image large, its versions, the review, and the actions on it. */
export function GraphicDetail({
  data, projectId, modelId, selectedRunId, reload,
}: {
  data: Workspace;
  projectId: string;
  modelId: string;
  selectedRunId?: string;
  reload: () => Promise<unknown>;
}) {
  return (
    <LightboxProvider>
      <GraphicDetailContent data={data} projectId={projectId} modelId={modelId} selectedRunId={selectedRunId} reload={reload} />
    </LightboxProvider>
  );
}

function GraphicDetailContent({ data, projectId, modelId, selectedRunId, reload }: {
  data: Workspace; projectId: string; modelId: string; selectedRunId?: string; reload: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const openLightbox = useLightbox();
  const [picked, setPicked] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const model: any = data.assetVersions.find((item) => item.id === modelId);
  const back = (
    <Breadcrumbs items={[
      { label: "Projects", link: { to: "/projects" } },
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
  const asset = data.assets?.find((asset) => asset.id === model.assetId);
  const name = asset?.title || model.name.replaceAll("_", " ");
  const runs = data.runs.filter((run) => run.modelId === modelId);
  const builds = runs
    .filter((run: any) => {
      if (!isFlatRole(run.role) || run.status !== "done" || !run.result?.key) return false;
      const parts = namedParts.safeParse(run.result.parts);
      return !parts.success || !parts.data.length || parts.data[0]?.key === run.result.key;
    })
    .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const reviewOf = (build: any): Review | undefined =>
    (runs.find((run: any) => run.role.endsWith("-judge") && run.status === "done" && run.iteration === build.iteration
      && new Date(run.createdAt) >= new Date(build.createdAt)) as any)?.result;
  const current = builds.find((build) => build.id === (picked ?? selectedRunId)) ?? builds.at(-1);
  const liveCanvas = !picked && model.artifacts?.stage === "construction";
  const currentKey = liveCanvas ? model.artifacts?.image : (current?.result as { key?: string } | undefined)?.key ?? model.artifacts?.image;
  const savedPreviews = svgPreviews.safeParse(current?.result);
  const nativePreviews = currentKey?.endsWith(".svg") && savedPreviews.success
    ? savedPreviews.data.previews.flatMap((preview) => {
      const match = /\/preview-(dark-)?(16|24|64)\.png$/.exec(preview.key);
      return match ? [{ ...preview, size: Number(match[2]), dark: Boolean(match[1]) }] : [];
    }) : [];
  const savedTarget = z.object({ visualTarget: z.string() }).safeParse(current?.result);
  const target = savedTarget.success ? savedTarget.data.visualTarget : model.artifacts?.visualTarget ?? (!currentKey ? model.visualTarget : undefined);
  const selectedParts = z.object({ parts: namedParts }).safeParse(current?.result);
  const latestParts = namedParts.safeParse(currentKey === model.artifacts?.image ? model.artifacts?.parts : undefined);
  const parts = selectedParts.success ? selectedParts.data.parts
    : (!current || current.id === builds.at(-1)?.id) && latestParts.success ? latestParts.data : [];
  const partGallery = parts.map((part) => ({ src: fileUrl(part.key), title: `${name} · ${part.name}` }));
  const review: Review | undefined = !current || (current.id === builds.at(-1)?.id && model.phase === "Complete · output dimension error")
    ? model.feedback : reviewOf(current);
  const batch = (data.batches as any[]).find((item) => item.id === model.batchId);
  const outdated = !!batch && batch.designVersion < data.project.designVersion;
  const archived = Boolean(data.project.archivedAt);
  const working = !["done", "failed", "cancelled"].includes(model.status);
  const cost = runs.reduce((sum, run) => sum + (run.estimatedCost || 0), 0);
  const format = (key?: string) => (key?.endsWith(".svg") ? "SVG" : "PNG");
  const pixelated = data.project.assetType === "pixel";
  const gallery = builds.map((build: any, index) => ({
    pixelated, src: fileUrl(build.result.key), title: `${name} · review round ${index + 1}`, caption: reviewOf(build)?.summary,
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
          <div className="flex items-center gap-2"><h1>{name}</h1>
            {asset && <RenameButton kind="asset" name={name} endpoint={`projects/${projectId}/assets/${asset.id}`} onSaved={reload} />}
          </div>
          <div className="page-meta">
            {asset?.title && model.name !== name && <span className="muted">{model.name}</span>}
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
          {current && !archived && !working && <>
            {pixelated && <PixelEditor key={current.id} modelId={modelId} projectId={projectId} sourceRunId={current.id} />}
            <GraphicVariant projectId={projectId} model={model} sourceRunId={current.id} onSaved={reload} />
          </>}
          {!archived && (
            <ReopenAsIdea id={modelId} name={name}
              onDone={() => navigate({ to: "/projects/$projectId", params: { projectId }, search: { tab: "idea" } })} />
          )}
          {!archived && (
            <DeleteAsset id={modelId} name={name}
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
        <Button variant="outline" disabled={busy} onClick={() => void act(() => request(`asset-versions/${modelId}/retry`, json({})))}>
          {busy && <LoaderCircle className="spin" size={16} />} Resume
        </Button>
      )}
      {model.status === "awaiting_approval" && model.visualTarget && !archived && (
        <VisualTargetReview key={model.visualTarget} modelId={modelId} target={model.visualTarget} onRefresh={reload} />
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(320px,1fr)_minmax(0,2fr)]">
        <GraphicConversation key={modelId} projectId={projectId} modelId={modelId}
          sourceRunId={current?.id} asset={asset} runs={runs} prompt={model.prompt}
          working={working} archived={archived} designReady={data.project.status === "ready"}
          onRefresh={reload} />
        <div className="order-1 min-w-0 space-y-6 lg:order-2">
        <Card className="panel">
          {currentKey ? (
            <button type="button" aria-label="Open full size" className="block w-full"
              onClick={() => openLightbox(liveCanvas && currentKey ? [{ pixelated, src: fileUrl(currentKey), title: `${name} · construction in progress` }] : gallery, liveCanvas ? 0 : Math.max(0, builds.findIndex((build) => build.id === current?.id)))}>
              <AssetImage src={fileUrl(currentKey)} width={1280} pixelated={pixelated} alt={name}
                className="mx-auto aspect-square w-full max-w-[640px] rounded-lg bg-white" style={{ objectFit: "contain" }} />
            </button>
          ) : (
            <p className="muted">{working ? "Generating. The image appears here when it is ready." : "No image was saved for this graphic."}</p>
          )}
          {nativePreviews.length > 0 && (
            <section className="mt-6" aria-label="SVG previews at actual size">
              <h2>Actual size</h2>
              <div className="mt-3 flex flex-wrap gap-4">
                {nativePreviews.map((preview) => (
                  <figure key={preview.key} className="space-y-2">
                    <div className="flex h-24 w-24 items-center justify-center rounded-md border"
                      style={{ backgroundColor: preview.dark ? "#18181b" : "#ffffff" }}>
                      <AssetImage src={fileUrl(preview.key)} width="full" alt={preview.label}
                        style={{ width: preview.size, height: preview.size, imageRendering: "auto" }} />
                    </div>
                    <figcaption className="text-xs text-muted-foreground">
                      {preview.size}px · {preview.dark ? "Dark" : "Light"}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
          {parts.length > 0 && (
            <section className="mt-6" aria-label="Named asset parts">
              <h2>Parts</h2>
              <ul className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                {parts.map((part, index) => (
                  <li key={part.name} className="overflow-hidden rounded-lg border bg-card">
                    <button type="button" className="block w-full" aria-label={`Open ${part.name} full size`}
                      onClick={() => openLightbox(partGallery, index)}>
                      <AssetImage src={fileUrl(part.key)} width={640} alt={part.name}
                        className="aspect-square w-full bg-white" style={{ objectFit: "contain" }} />
                    </button>
                    <div className="flex items-center justify-between gap-2 p-3">
                      <span className="min-w-0 break-words">{part.name}</span>
                      <Button variant="outline" size="sm" asChild>
                        <a href={fileUrl(part.key)} download aria-label={`Download ${part.name}`}><Download size={14} /> {format(part.key)}</a>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {pixelated && current && <PixelExports exports={(current.result as any)?.exports} review={(current.result as any)?.review} />}
          {data.project.assetType === "cad" && current && <CadExports exports={(current.result as any)?.exports} previews={(current.result as any)?.previews} analysis={(current.result as any)?.analysis} />}
          {builds.length > 1 && (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Review rounds">
              {builds.map((build: any, index) => (
                <li key={build.id}>
                  <button type="button" aria-pressed={build.id === current?.id} aria-label={`Review round ${index + 1}`}
                    className="block size-20 overflow-hidden rounded-md border bg-white aria-pressed:ring-2 aria-pressed:ring-primary"
                    onClick={() => setPicked(build.id)}>
                    <AssetImage src={fileUrl(build.result.key)} width={320} pixelated={pixelated} alt="" className="size-full" style={{ objectFit: "contain" }} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="grid gap-4 sm:grid-cols-2">
          {target && model.status !== "awaiting_approval" && <Card className="panel">
            <h2>Visual target</h2>
            <p className="muted">Design reference used to construct this asset.</p>
            <button type="button" className="block w-full" aria-label="Open visual target"
              onClick={() => openLightbox([{ src: fileUrl(target), title: "Visual target" }])}>
              <AssetImage src={fileUrl(target)} alt="Visual target" className="aspect-square w-full rounded-md" style={{ objectFit: "contain" }} />
            </button>
          </Card>}
          <Card className="panel">
            <h2>Review</h2>
            {review?.summary ? (
              <ReviewNotes review={review} />
            ) : (
              <p className="muted">{working ? "The review appears when the first build is judged." : "This round was not reviewed."}</p>
            )}
          </Card>
          <Card className="panel">
            <h2>Prompt</h2>
            <p className="whitespace-pre-wrap">{model.prompt}</p>
          </Card>
        </div>
      </div>
      </div>
      <details className="panel p-4">
        <summary className="cursor-pointer">Debug: how the agents made this</summary>
        <div className="mt-4"><BuildTrace modelId={modelId} working={working} /></div>
      </details>

    </main>
  );
}
