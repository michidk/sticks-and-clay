import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { svgIntentHints, svgIntentLabels, svgIntentOf, svgIntents, workshopSchema, type SvgIntent, type Workshop } from "@/lib/workshop";
import { request, json } from "@/lib/client";

/** Picks what an SVG project makes; each new batch freezes the choice. */
export function ProjectSvgIntent({ projectId, workshop, disabled, onSaved }: {
  projectId: string; workshop: Workshop | null; disabled: boolean; onSaved: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const intent = svgIntentOf(workshop);
  async function save(value: SvgIntent) {
    setBusy(true); setError("");
    try {
      await request(`projects/${projectId}/workshop`, json({ ...workshopSchema.parse(workshop ?? {}), svgIntent: value }, "PUT"));
      await onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <div className="panel mb-6 space-y-3">
    <div className="space-y-2">
      <Label htmlFor="svg-intent">SVG intent</Label>
      <Select value={intent} onValueChange={(value) => save(value as SvgIntent)} disabled={disabled || busy}>
        <SelectTrigger id="svg-intent"><SelectValue /></SelectTrigger>
        <SelectContent>
          {svgIntents.map((value) => <SelectItem key={value} value={value}>{svgIntentLabels[value]}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="muted">{svgIntentHints[intent]}. Applies to future versions; saved versions keep the intent they were made with.</p>
    </div>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>;
}
