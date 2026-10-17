import { useEffect, useState } from "react";
import { PictureUploader } from "@/components/picture-uploader";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useImageUpload } from "@/hooks/use-image-upload";
import { appendReferenceImages } from "@/lib/image-file";
import { request } from "@/lib/client";

export function AssetReferences({ projectId, assetId, references, referenceNotes, onRefresh }: {
  projectId: string;
  assetId: string;
  references: string[];
  referenceNotes: Record<string, string>;
  onRefresh: () => Promise<unknown>;
}) {
  const uploader = useImageUpload();
  const [notes, setNotes] = useState(referenceNotes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    uploader.reset(references);
    setNotes(referenceNotes);
  }, [assetId, JSON.stringify(references), JSON.stringify(referenceNotes)]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      appendReferenceImages(form, uploader.images);
      form.set("referenceNotes", JSON.stringify(notes));
      form.set("expected", JSON.stringify({ references, referenceNotes }));
      await request(`projects/${projectId}/assets/${assetId}/references`, { method: "POST", body: form });
      await onRefresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save references");
    } finally {
      setBusy(false);
    }
  }
  return <div className="space-y-3">
    <PictureUploader title="Asset references" images={uploader.images} onFilesAdded={uploader.addFiles}
      onImportFromUrl={uploader.importFromUrl} onRemove={uploader.remove} disabled={busy} isBusy={uploader.isBusy}
      notes={notes} onNoteChange={(key, note) => setNotes((current) => ({ ...current, [key]: note }))} />
    <p className="muted">Changes apply to future versions. Saved versions keep their original references.</p>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <Button type="button" variant="outline" disabled={busy || uploader.isBusy} onClick={() => void save()}>{busy ? "Saving…" : "Save references"}</Button>
  </div>;
}
