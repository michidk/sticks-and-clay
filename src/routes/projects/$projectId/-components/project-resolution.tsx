import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResolutionFields, resolutionFromForm } from "@/components/resolution-fields";
import { workshopSchema, type Workshop } from "@/lib/workshop";
import { request, json } from "@/lib/client";

export function ProjectResolution({ projectId, type, workshop, disabled, onSaved }: {
  projectId: string; type: "pixel" | "graphic"; workshop: Workshop | null; disabled: boolean; onSaved: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await request(`projects/${projectId}/workshop`, json({ ...workshopSchema.parse(workshop ?? {}), resolution: resolutionFromForm(form) }, "PUT"));
      await onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="panel mb-6 space-y-3">
    <fieldset disabled={disabled || busy} className="space-y-3">
      <ResolutionFields key={workshop?.version ?? 0} type={type} value={workshop?.resolution} />
      <p className="muted">Applies to future versions. Each asset can override this setting.</p>
      <Button type="submit" variant="outline">{busy ? "Saving…" : "Save project resolution"}</Button>
    </fieldset>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </form>;
}
