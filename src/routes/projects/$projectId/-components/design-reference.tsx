import { DesignConversation, type DesignRevision, type DesignUpdate } from "./design-conversation";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { TextSkeleton } from "@/components/loading";
import { PictureUploader } from "@/components/picture-uploader";
import { useImageUpload } from "@/hooks/use-image-upload";
import { appendReferenceImages } from "@/lib/image-file";
import { json, request } from "@/lib/client";

/** Design document editor with references and revision history. */
export function DesignReference({
  project,
  revisions,
  onSaved,
  onOpenMockups,
  updating = false,
  updates = [],
}: {
  project: any;
  revisions: DesignRevision[];
  onSaved: (approved: boolean) => Promise<unknown>;
  onOpenMockups: () => void;
  updating?: boolean;
  updates?: DesignUpdate[];
}) {
  const uploader = useImageUpload();
  const [design, setDesign] = useState(project.design || "");
  const [version, setVersion] = useState(project.designVersion);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>(project.referenceNotes ?? {});
  const ready = project.status === "ready";
  const savedNote = (key: string) => (project.referenceNotes?.[key] ?? "").trim();
  const referencesChanged =
    uploader.images.length !== project.references.length ||
    uploader.images.some(
      (image, index) => image.key !== project.references[index],
    ) ||
    uploader.images.some((image) => image.key && (notes[image.key] ?? "").trim() !== savedNote(image.key));
  const changed = design !== project.design || referencesChanged;
  const stale = version !== project.designVersion;
  const saving = busy || uploader.isBusy || updating;
  // Adopt the server document whenever its version changes and nothing is being edited.
  const [synced, setSynced] = useState(-1);
  useEffect(() => {
    if (project.designVersion === synced || editing) return;
    setDesign(project.design || "");
    setVersion(project.designVersion);
    uploader.reset(project.references);
    setNotes(project.referenceNotes ?? {});
    setSynced(project.designVersion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.designVersion, editing, synced]);
  const headings = [...(design || "").matchAll(/^## (.+)$/gm)].map(
    (match, index) => ({ title: match[1], id: `design-section-${index}` }),
  );
  let headingIndex = 0;
  function discard() {
    setDesign(project.design);
    setVersion(project.designVersion);
    uploader.reset(project.references);
    setNotes(project.referenceNotes ?? {});
    setEditing(false);
  }
  async function save(approve: boolean) {
    if (saving || stale) return;
    setBusy(true);
    setError("");
    try {
      if (approve && !changed) {
        // Nothing to save: accept the current revision instead of writing a duplicate.
        await request(`projects/${project.id}/design/approve`, json({ version }));
        setEditing(false);
        await onSaved(true);
        return;
      }
      const form = new FormData();
      form.set("design", design);
      form.set("version", String(version));
      form.set("approve", String(approve));
      appendReferenceImages(form, uploader.images);
      form.set("referenceNotes", JSON.stringify(notes));
      await request(`projects/${project.id}/design`, {
        method: "PUT",
        body: form,
      });
      setEditing(false);
      setSynced(-1);
      await onSaved(approve);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="design-studio">
      <DesignConversation
        project={project}
        revisions={revisions}
        updates={updates}
        locked={saving || stale || changed || !project.design || !["ready", "review"].includes(project.status)}
        blockedReason={updating ? "A design update is in progress. Follow it in the queue."
          : stale ? "Load the latest design revision before sending changes."
          : changed ? "Save or discard your document and reference edits before sending changes."
          : "Wait for the design to become available."}
        onChanged={() => onSaved(false)}
        onOpenMockups={onOpenMockups}
      />
      <div className="design-document-column">
      <Card className="panel">
        <div className="section-title">
          <div>
            <h2>Design reference · v{version}</h2>
            <p className="muted">
              {updating
                ? "Updating design. The current revision stays available while the draft is prepared."
                : changed
                ? "Unsaved changes"
                : ready
                  ? "Approved. New generation uses this version."
                  : "Awaiting approval"}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {project.design && (
              <Button
                variant="outline"
                onClick={() => {
                  const field = document.getElementById("design-change-prompt");
                  field?.scrollIntoView({ block: "center" });
                  field?.focus();
                }}
              >
                <MessageSquare size={16} /> Request changes
              </Button>
            )}
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setEditing(!editing)}
            >
              {editing ? "Preview" : "Edit"}
            </Button>
          </div>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {stale && editing && (
          <Alert>
            <AlertDescription>
              <p>A newer design revision is available. Your edits are preserved. Load the latest revision before saving or approving.</p>
              <Button variant="outline" onClick={discard} disabled={saving}>
                Discard edits and load latest
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {!editing && !!headings.length && (
          <nav className="design-contents" aria-label="Design sections">
            {headings.map((heading) => (
              <a key={heading.id} href={`#${heading.id}`}>
                {heading.title}
              </a>
            ))}
          </nav>
        )}
        {editing ? (
          <Textarea
            className="design-editor"
            aria-label="Design reference"
            disabled={saving}
            value={design}
            onChange={(e) => setDesign(e.target.value)}
          />
        ) : (
          <div className="markdown">
            {design ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({ children }) => (
                    <h2 id={`design-section-${headingIndex++}`}>{children}</h2>
                  ),
                }}
              >
                {design}
              </ReactMarkdown>
            ) : (
              <TextSkeleton label="Preparing design reference" lines={8} />
            )}
          </div>
        )}
        {project.design && (editing || changed || !ready) && (
          <div className="actions design-actions">
            <span>
              {changed
                ? "Saving a draft requires approval before new generation. Existing batches keep their snapshot."
                : "Approve to enable generation."}
            </span>
            {(editing || changed) && (
              <Button variant="ghost" disabled={saving} onClick={discard}>
                Discard edits
              </Button>
            )}
            <Button
              variant="outline"
              disabled={saving || stale || !changed || !design.trim()}
              onClick={() => save(false)}
            >
              Save draft
            </Button>
            <Button
              variant="default"
              disabled={saving || stale || !design.trim()}
              onClick={() => save(true)}
            >
              <Check size={17} />
              {busy ? "Saving…" : changed ? "Save and approve" : "Approve"}
            </Button>
          </div>
        )}
      </Card>
        <Card className="panel">
          <PictureUploader
            images={uploader.images}
            onFilesAdded={uploader.addFiles}
            onImportFromUrl={uploader.importFromUrl}
            onRemove={uploader.remove}
            notes={notes}
            onNoteChange={(key, note) => setNotes((current) => ({ ...current, [key]: note }))}
            disabled={saving}
            isBusy={uploader.isBusy}
          />
          <p className="muted">
            Reference changes are saved with the document. They do not rewrite
            it.
          </p>
        </Card>
      </div>
    </div>
  );
}
