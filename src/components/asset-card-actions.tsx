import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Download, GitFork, Images, Lightbulb, MoreHorizontal, RotateCcw, Square, Trash2, Undo2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AssetReferences } from "@/components/asset-references";
import { assetStage } from "@/lib/board";
import { fileUrl, json, request } from "@/lib/client";
import { DeleteAsset } from "@/routes/projects/$projectId/-components/delete-asset";
import { GraphicVariant } from "@/routes/projects/$projectId/-components/graphic-variant";
import { ReopenAsIdea } from "@/routes/projects/$projectId/-components/reopen-as-idea";

const finished = ["done", "failed", "cancelled"];

type Version = {
  id: string;
  name: string;
  status: string;
  visualTarget?: string | null;
  acceptedAt?: string | Date | null;
  artifacts?: any;
};

/**
 * The actions of one asset card, shared by the project stages and the global board.
 * Owner decisions stay visible (Approve & build, Accept, Iterate, Abort, Resume, Back to review, Open);
 * downloads and less frequent actions live in the "More actions" menu. Archived projects only open and download.
 */
export function AssetCardActions({
  projectId,
  version,
  name,
  asset,
  rootId,
  versions = 1,
  isGraphics,
  archived,
  designReady,
  outdated = false,
  sourceRunId,
  renderFailure,
  resumingBatch = false,
  onResumeBatch,
  cancelling = false,
  className,
  onRefresh,
  onError,
  onReturnedToIdea,
}: {
  projectId: string;
  version: Version;
  /** The asset's display name, used in accessible names and dialogs. */
  name: string;
  asset?: { id: string; references?: string[]; referenceNotes?: Record<string, string> };
  /** The collection entry's first version: reopening and deleting act on the whole entry. */
  rootId?: string;
  /** How many versions the entry holds, for the delete confirmation. */
  versions?: number;
  isGraphics: boolean;
  archived: boolean;
  designReady: boolean;
  /** The version was generated from an older design; Regenerate replaces Iterate. */
  outdated?: boolean;
  sourceRunId?: string;
  renderFailure?: { id: string };
  resumingBatch?: boolean;
  onResumeBatch?: (batchId: string) => void;
  /** A running job is already being cancelled. */
  cancelling?: boolean;
  className?: string;
  onRefresh: () => Promise<unknown>;
  /** Report failures to the page; without it the error shows above the actions. */
  onError?: (message: string) => void;
  onReturnedToIdea?: () => void;
}) {
  const [pending, setPending] = useState("");
  const [localError, setLocalError] = useState("");
  const [dialog, setDialog] = useState<"references" | "fork" | "reopen" | "delete" | null>(null);
  const stage = assetStage(version);
  const working = !finished.includes(version.status);
  const editable = !archived;
  const link = { to: "/projects/$projectId/models/$modelId" as const, params: { projectId, modelId: version.id } };
  const search = { view: version.artifacts ? "3d" : "target", section: "review" } as const;
  const image: string | undefined = isGraphics ? version.artifacts?.image : undefined;
  const imageFormat = version.artifacts?.format === "svg" ? "SVG" : "PNG";
  const glb: string | undefined = !isGraphics ? version.artifacts?.glb : undefined;
  const blend: string | undefined = !isGraphics ? version.artifacts?.blend : undefined;

  async function send(key: string, path: string, body: unknown, fallback: string) {
    setPending(key);
    setLocalError("");
    try {
      await request(path, json(body));
      await onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : fallback;
      if (onError) onError(message);
      else setLocalError(message);
    } finally {
      setPending("");
    }
  }
  const busy = Boolean(pending);
  const canFork = editable && isGraphics && Boolean(image);
  const canReopen = editable && Boolean(rootId);
  const canDelete = editable && Boolean(rootId);
  const canReferences = editable && Boolean(asset);
  const canRetryRenders = editable && Boolean(renderFailure && onResumeBatch);
  const hasMenu = Boolean(image || glb || blend) || canFork || canReopen || canDelete || canReferences || canRetryRenders;

  return (
    <>
      {localError && <Alert variant="destructive"><AlertDescription>{localError}</AlertDescription></Alert>}
      <div className={`asset-card-actions ${className ?? ""}`.trim()}>
        {editable && version.status === "awaiting_approval" && version.visualTarget && (
          <Button size="sm" disabled={busy} onClick={() => void send("approve", `models/${version.id}/visual-target`, { action: "approve", target: version.visualTarget }, "Could not approve visual target")}>
            <Check size={14} /> {pending === "approve" ? "Approving…" : "Approve & build"}
          </Button>
        )}
        {editable && stage === "review" && (
          <Button size="sm" disabled={busy} onClick={() => void send("accept", `models/${version.id}/accept`, { accepted: true }, "Could not accept this asset")}>
            <Check size={14} /> {pending === "accept" ? "Accepting…" : "Accept"}
          </Button>
        )}
        {editable && !working && (stage === "review" || outdated) && (
          <GraphicVariant
            projectId={projectId}
            kind="iterate"
            size="sm"
            iterateLabel={outdated ? "Regenerate" : "Iterate"}
            model={version}
            sourceRunId={sourceRunId}
            designReady={designReady}
            onSaved={onRefresh}
          />
        )}
        {editable && stage === "done" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void send("unaccept", `models/${version.id}/accept`, { accepted: false }, "Could not move this asset back to review")}>
            <Undo2 size={14} /> Back to review
          </Button>
        )}
        {editable && working && (
          <Button size="sm" variant="outline" disabled={busy || cancelling}
            title="Stop generating. The asset returns to its previous state; the attempt stays in history."
            onClick={() => void send("abort", `models/${version.id}/abort`, {}, "Could not stop generation")}>
            <Square size={14} /> {pending === "abort" ? "Stopping…" : "Abort"}
          </Button>
        )}
        {editable && version.status === "failed" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void send("resume", `models/${version.id}/retry`, {}, "Could not resume generation")}>
            {pending === "resume" ? "Resuming…" : "Resume"}
          </Button>
        )}
        <Button size="sm" variant="outline" asChild>
          <Link {...link} search={search} aria-label={`Open ${name}`}>Open</Link>
        </Button>
        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`More actions for ${name}`}>
                <MoreHorizontal size={16} />
              </Button>
            </DropdownMenuTrigger>
            {/* An item that opens a dialog keeps focus there instead of returning it to this trigger. */}
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => { if (dialog) event.preventDefault(); }}>
              {image && (
                <DropdownMenuItem asChild>
                  <a href={fileUrl(image)} download><Download size={15} /> Download {imageFormat}</a>
                </DropdownMenuItem>
              )}
              {glb && (
                <DropdownMenuItem asChild>
                  <a href={fileUrl(glb)} download><Download size={15} /> Download GLB</a>
                </DropdownMenuItem>
              )}
              {blend && (
                <DropdownMenuItem asChild>
                  <a href={fileUrl(blend)} download><Download size={15} /> Download Blender source</a>
                </DropdownMenuItem>
              )}
              {canRetryRenders && (
                <DropdownMenuItem disabled={resumingBatch} onSelect={() => onResumeBatch!(renderFailure!.id)}>
                  <RotateCcw size={15} /> Retry renders
                </DropdownMenuItem>
              )}
              {canFork && (
                <DropdownMenuItem disabled={!sourceRunId} onSelect={() => setDialog("fork")}>
                  <GitFork size={15} /> Fork variant…
                </DropdownMenuItem>
              )}
              {canReferences && (
                <DropdownMenuItem onSelect={() => setDialog("references")}>
                  <Images size={15} /> References…
                </DropdownMenuItem>
              )}
              {canReopen && (
                <DropdownMenuItem onSelect={() => setDialog("reopen")}>
                  <Lightbulb size={15} /> Reopen as new idea…
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDialog("delete")}>
                  <Trash2 size={15} /> Delete asset…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {canFork && (
        <GraphicVariant
          projectId={projectId}
          model={version}
          sourceRunId={sourceRunId}
          onSaved={onRefresh}
          open={dialog === "fork"}
          onOpenChange={(open) => setDialog(open ? "fork" : null)}
        />
      )}
      {canReopen && (
        <ReopenAsIdea
          id={rootId!}
          name={name}
          open={dialog === "reopen"}
          onOpenChange={(open) => setDialog(open ? "reopen" : null)}
          onDone={async () => { await onRefresh(); onReturnedToIdea?.(); }}
        />
      )}
      {canDelete && (
        <DeleteAsset
          id={rootId!}
          name={name}
          versions={versions}
          open={dialog === "delete"}
          onOpenChange={(open) => setDialog(open ? "delete" : null)}
          onDeleted={onRefresh}
        />
      )}
      {canReferences && (
        <AssetReferencesDialog
          projectId={projectId}
          asset={asset!}
          open={dialog === "references"}
          onOpenChange={(open) => setDialog(open ? "references" : null)}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}

/** An asset's own reference images and notes, edited in a dialog. */
export function AssetReferencesDialog({ projectId, asset, open, onOpenChange, onRefresh }: {
  projectId: string;
  asset: { id: string; references?: string[]; referenceNotes?: Record<string, string> };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asset references</DialogTitle>
          <DialogDescription>Changes apply to future versions. Saved versions keep their original references.</DialogDescription>
        </DialogHeader>
        {open && (
          <AssetReferences projectId={projectId} assetId={asset.id} references={asset.references ?? []} referenceNotes={asset.referenceNotes ?? {}} onRefresh={onRefresh} />
        )}
        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
