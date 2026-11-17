import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Bot, ScanEye } from "lucide-react";
import { AssetReferences } from "@/components/asset-references";
import { AssetImage } from "@/components/asset-image";
import { useLightbox } from "@/components/image-lightbox";
import { request, json, fileUrl } from "@/lib/client";
import type { Workspace } from "../-lib/model";
import { ChangeComposer, branchRequest } from "./change-composer";

const conversationResult = z.object({ summary: z.string().optional() });

/** The graphic's story and the same change composer as the 3D page. */
export function GraphicConversation({ projectId, modelId, sourceRunId, asset, runs, prompt, changePrompt, changeImages, defaultRounds, working, archived, designReady, onRefresh }: {
  projectId: string;
  modelId: string;
  sourceRunId?: string;
  asset: NonNullable<Workspace["assets"]>[number] | undefined;
  runs: Workspace["runs"];
  prompt: string;
  changePrompt?: string | null;
  changeImages?: string[] | null;
  defaultRounds: number;
  working: boolean;
  archived: boolean;
  designReady: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const openLightbox = useLightbox();
  const [rounds, setRounds] = useState(defaultRounds);
  const disabled = working || archived || !designReady || !sourceRunId;
  async function send({ prompt: change, images }: { prompt: string; images: File[] }) {
    if (!sourceRunId) return;
    const result = change
      ? await request<{ id: string }>(`asset-versions/${modelId}/branch`, branchRequest({ kind: "iterate", sourceRunId, prompt: change, judgeIterations: rounds }, images))
      : await request<{ id: string }>(`asset-versions/${modelId}/regenerate`, json({}));
    await navigate({ to: "/projects/$projectId/models/$modelId", params: { projectId, modelId: result.id }, search: { view: "3d", section: "review" } });
    await onRefresh();
  }
  const hint = archived
    ? "This project is archived."
    : !designReady
      ? "Approve the design before generating a new version."
      : working
        ? "Generation is in progress."
        : "Describe a change, or send it blank to regenerate from the approved design · Ctrl or ⌘ + Enter sends";
  return (
    <section className="panel graphic-conversation" aria-label="Asset conversation">
      <h2>Conversation</h2>
      <div className="studio-chat-feed" aria-label="Version conversation">
        <details className="chat-message is-user chat-brief">
          <summary>Brief</summary>
          <p className="whitespace-pre-wrap">{prompt}</p>
        </details>
        {changePrompt && (
          <div className="chat-message is-user">
            <p className="whitespace-pre-wrap">{changePrompt}</p>
            {!!changeImages?.length && (
              <div className="chat-change-images">
                {changeImages.map((key, index) => (
                  <button key={key} type="button" aria-label={`Open attached image ${index + 1}`}
                    onClick={() => openLightbox(changeImages.map((item, position) => ({ src: fileUrl(item), title: `Attached image ${position + 1}` })), index)}>
                    <AssetImage src={fileUrl(key)} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {runs.filter((run) => run.status === "done").map((run) => {
          const result = conversationResult.safeParse(run.result);
          const review = run.role.endsWith("-judge");
          const Icon = review ? ScanEye : Bot;
          return result.success && result.data.summary ? (
            <div key={run.id} className="chat-message is-agent">
              <div className="chat-agent-head">
                <span className="chat-agent-icon"><Icon size={14} /></span>
                <strong>{review ? "Review" : "Build"}</strong>
              </div>
              <p className={review ? "is-clamped" : undefined}>{result.data.summary}</p>
            </div>
          ) : null;
        })}
      </div>
      {!archived && (
        <ChangeComposer
          hint={hint}
          disabled={disabled}
          allowEmpty
          placeholder="Describe the change. Paste or drop images to show it…"
          sendLabel="Generate version"
          rounds={rounds}
          onRoundsChange={setRounds}
          onSubmit={send}
          footer={asset && (
            <details className="studio-compose-design">
              <summary>Asset references{asset.references.length ? ` · ${asset.references.length}` : ""}</summary>
              <div className="conversation-design">
                <p>Saved with the asset and used by every later version, unlike images attached to one change.</p>
                <AssetReferences projectId={projectId} assetId={asset.id} references={asset.references}
                  referenceNotes={asset.referenceNotes} onRefresh={onRefresh} />
              </div>
            </details>
          )}
        />
      )}
    </section>
  );
}
