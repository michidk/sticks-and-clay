import { assetStage } from "@/lib/board";
import { AssetReferences } from "@/components/asset-references";
import { describeError } from "@/lib/error-message";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Boxes, Download, RotateCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AssetImage } from "@/components/asset-image";
import { ModelViewer } from "@/components/ui/model-viewer/lazy";
import { ViewerSkeleton } from "@/components/loading";
import { TriangleCount } from "@/components/triangle-count";
import { Progress, StatusBadge } from "@/components/status";
import { costSummary, fileUrl, json, request } from "@/lib/client";
import { GraphicVariant } from "./graphic-variant";
import { queueKindLabels } from "@/lib/queue-view";
import { DeleteAsset } from "./delete-asset";
import { ReopenAsIdea } from "./reopen-as-idea";

const finished = ["done", "failed", "cancelled"];

/** One collection entry: a model or graphic with its current state and files. */
export function AssetCard({
  projectId,
  asset,
  model,
  isGraphics,
  cost,
  sourceRunId,
  lineage,
  batch,
  currentDesignVersion,
  designReady,
  archived = false,
  deleteTarget,
  renderFailure,
  resumingBatch = false,
  onResumeBatch,
  previewing,
  onPreview,
  onRefresh,
  onError,
  onReturnedToIdea,
  activeJobs = [],
}: {
  projectId: string;
  asset?: { id: string; references: string[]; referenceNotes: Record<string, string> };
  model: any;
  isGraphics: boolean;
  cost: number;
  sourceRunId?: string;
  lineage?: string;
  /** The generation request this asset came from; its design version is frozen. */
  batch?: { designVersion: number };
  currentDesignVersion: number;
  designReady: boolean;
  archived?: boolean;
  /** The collection entry to delete (its root asset) and how many versions it holds. */
  deleteTarget?: { id: string; versions: number };
  /** The batch whose collection render failed after this model finished. */
  renderFailure?: { id: string; error?: string };
  resumingBatch?: boolean;
  onResumeBatch?: (batchId: string) => void;
  previewing: boolean;
  onPreview: (id: string | null) => void;
  onRefresh: () => Promise<unknown>;
  onError: (message: string) => void;
  /** Called after the asset was returned to ideas, once the project is refreshed. */
  onReturnedToIdea?: () => void;
  activeJobs?: { id: string; kind: string; status: string }[];
}) {
  const [resuming, setResuming] = useState(false);
  const m = model;
  const name = m.name.replaceAll("_", " ");
  const modelLink = {
    to: "/projects/$projectId/models/$modelId" as const,
    params: { projectId, modelId: m.id },
  };
  const working = !finished.includes(m.status);
  const outdated = !!batch && batch.designVersion < currentDesignVersion;
  async function regenerate() {
    if (resuming || !designReady) return;
    setResuming(true);
    try {
      await request(`asset-versions/${m.id}/regenerate`, json({}));
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setResuming(false);
    }
  }
  async function resume() {
    setResuming(true);
    try {
      await request("asset-versions/" + m.id + "/retry", json({}));
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setResuming(false);
    }
  }
  return (
    <Card className="model-card">
      <div className={`model-cover${isGraphics ? " graphic-cover" : ""}`}>
        {isGraphics && m.artifacts?.image ? (
          <Link className="model-cover-image" {...modelLink} search={{ view: "3d", section: "review" }}>
            <AssetImage src={fileUrl(m.artifacts.image)} pixelated={m.artifacts.format === "pixel"} alt={name} />
          </Link>
        ) : previewing && m.artifacts ? (
          <ModelViewer
            src={fileUrl(m.artifacts.glb)}
            aria-label={`${name} preview`}
            className="model-card-viewer"
            height="100%"
            showUi={false}
            defaultAutoRotate
            loadingFallback={<ViewerSkeleton overlay />}
          />
        ) : (
          <Link
            className="model-cover-image"
            {...modelLink}
            search={{ view: m.artifacts ? "3d" : "target", section: "review" }}
          >
            {m.artifacts?.renders?.[0] || m.visualTarget ? (
              <AssetImage
                src={fileUrl(m.artifacts?.renders?.[0] || m.visualTarget)}
                alt={name}
              />
            ) : (
              <div className="abstract">
                <Boxes size={44} strokeWidth={1} />
              </div>
            )}
            {!m.artifacts && m.visualTarget && (
              <span className="cover-provenance">Visual target</span>
            )}
          </Link>
        )}
        <StatusBadge status={m.status} verdict={m.verdict === "limit_reached" ? m.verdict : undefined} />
        {!isGraphics && m.artifacts && (
          <Button
            variant="outline"
            size="sm"
            className="cover-toggle"
            onClick={() => onPreview(previewing ? null : m.id)}
            aria-pressed={previewing}
          >
            {previewing ? "Show render" : "Preview in 3D"}
          </Button>
        )}
      </div>
      <div className="project-body">
        {activeJobs.map((job) => (
          <StatusBadge key={job.id} status={job.status}>
            {queueKindLabels[job.kind] || job.kind} · {job.status}
          </StatusBadge>
        ))}
        {batch && (
          <StatusBadge tone={outdated ? "warning" : "queued"}>
            Design v{batch.designVersion}{outdated ? " · outdated" : ""}
          </StatusBadge>
        )}
        <h3>
          <Link {...modelLink} search={{ view: "3d", section: "review" }}>{name}</Link>
        </h3>
        {lineage && <span className="model-branch-label">{lineage}</span>}
        <p>{m.prompt}</p>
        {working && (
          <Progress value={m.progress} label={m.phase} status={m.status} />
        )}
        {m.artifacts?.stage === "geometry" && (
          <p className="note">Geometry only. Materials pending.</p>
        )}
        {isGraphics && m.feedback && !working && (
          <details className="note">
            <summary>Review {m.feedback.score}/100 · {m.feedback.summary}</summary>
            {m.verdict !== "approved" && m.feedback.improvements?.length > 0 && (
              <ul>
                {m.feedback.improvements.map((item: { priority: string; issue: string }, index: number) => (
                  <li key={index}>[{item.priority}] {item.issue}</li>
                ))}
              </ul>
            )}
          </details>
        )}
        {m.error && (
          <Alert variant="destructive" className="error">
            <AlertDescription>{describeError(m.error)}</AlertDescription>
          </Alert>
        )}
        {renderFailure && (
          <Alert variant="destructive" className="error">
            <AlertTitle>Collection renders failed</AlertTitle>
            <AlertDescription>
              <p>{isGraphics ? "The collection sheet for this batch did not render." : "The lineup and demo scene for this model did not render."}</p>
              <p className="break-all">
                {describeError(renderFailure.error) ||
                  "Rendering stopped before it finished."}
              </p>
            </AlertDescription>
          </Alert>
        )}
        <div className="card-meta">
          <span>
            {m.artifacts && !isGraphics ? (
              <TriangleCount artifacts={m.artifacts} suffix />
            ) : isGraphics && m.artifacts?.image ? (
              m.artifacts?.format === "svg" ? "SVG" : "PNG"
            ) : working ? (
              ""
            ) : (
              m.phase
            )}
          </span>
          <span>Est. {costSummary(cost)}</span>
        </div>
        <div className="card-actions">
          {m.status === "failed" && (
            <Button variant="outline" disabled={resuming} onClick={resume}>
              {resuming ? "Resuming…" : "Resume"}
            </Button>
          )}
          {(outdated || assetStage(m) === "review") && !archived && !working && (
            <Button variant="outline" disabled={resuming || !designReady} onClick={regenerate}
              title={!designReady ? "Approve the design before regenerating" : "Create another version using the current design. Previous versions stay available."}>
              <RotateCw size={14} /> {resuming ? "Regenerating…" : outdated ? `Regenerate on v${currentDesignVersion}` : "Regenerate"}
            </Button>
          )}
          {renderFailure && onResumeBatch && (
            <Button
              variant="outline"
              disabled={resumingBatch}
              onClick={() => onResumeBatch(renderFailure.id)}
            >
              Retry renders
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link {...modelLink} search={{ view: "3d", section: "review" }}>
              {isGraphics ? "Open" : "Open model"}
            </Link>
          </Button>
          {isGraphics && m.artifacts?.image && (
            <>
              <Button variant="outline" asChild>
                <a href={fileUrl(m.artifacts.image)} download>
                  <Download size={14} /> {m.artifacts?.format === "svg" ? "SVG" : "PNG"}
                </a>
              </Button>
              <GraphicVariant
                model={m}
                sourceRunId={sourceRunId}
                onSaved={onRefresh}
              />
            </>
          )}
          {!isGraphics && m.artifacts && (
            <>
              <Button variant="ghost" asChild>
                <a href={fileUrl(m.artifacts.glb)} download>
                  <Download size={14} /> GLB
                </a>
              </Button>
              <Button variant="ghost" asChild>
                <a href={fileUrl(m.artifacts.blend)} download>
                  Blender source
                </a>
              </Button>
            </>
          )}
          {deleteTarget && !archived && (
            <ReopenAsIdea id={deleteTarget.id} name={name} onDone={async () => { await onRefresh(); onReturnedToIdea?.(); }} />
          )}
          {deleteTarget && !archived && (
            <DeleteAsset id={deleteTarget.id} name={name} versions={deleteTarget.versions}
              disabled={working} onDeleted={onRefresh} />
          )}
        </div>
      </div>
    {asset && !archived && <details className="m-4"><summary className="cursor-pointer">Asset references</summary><AssetReferences projectId={projectId} assetId={asset.id} references={asset.references} referenceNotes={asset.referenceNotes} onRefresh={onRefresh} /></details>}
      </Card>
  );
}
