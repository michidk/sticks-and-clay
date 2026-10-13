import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AssetImage } from "@/components/asset-image";
import { request, json, fileUrl } from "@/lib/client";
import { workshopSchema } from "@/lib/workshop";

export function WorkshopPanel({
  project,
  versions,
  models,
  onSaved,
}: {
  project: any;
  versions: any[];
  models: any[];
  onSaved: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(() =>
    workshopSchema.parse(project.workshop || {}),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const examples = versions.filter(
    (v) =>
      v.status === "done" &&
      (v.artifacts?.blend || v.artifacts?.image) &&
      v.artifacts.stage !== "geometry",
  );
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await request(
        `projects/${project.id}/workshop`,
        json(draft, "PUT"),
      );
      setDraft(result.workshop);
      await onSaved();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="panel">
      <form onSubmit={save} className="space-y-5">
        <div>
          <h2>Collection style & memory</h2>
          <p className="muted">
            Shared lessons and selected examples guide future batches. The
            approved design stays authoritative; existing batches keep their
            snapshots.
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="workshop-memory">Project memory</Label>
          <Textarea
            disabled={busy}
            id="workshop-memory"
            rows={5}
            maxLength={8000}
            value={draft.memory}
            onChange={(e) => {
              setSaved(false);
              setDraft({ ...draft, memory: e.target.value });
            }}
            placeholder="Reusable construction decisions and lessons from successful assets"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="workshop-style">Shared style</Label>
          <Textarea
            disabled={busy}
            id="workshop-style"
            rows={4}
            maxLength={4000}
            value={draft.style}
            onChange={(e) => {
              setSaved(false);
              setDraft({ ...draft, style: e.target.value });
            }}
            placeholder="Palette, proportions, bevels, materials and permitted exceptions"
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="workshop-variation">Variation (0–100)</Label>
            <Input
              disabled={busy}
              id="workshop-variation"
              type="number"
              min={0}
              max={100}
              value={draft.variation}
              onChange={(e) => {
                setSaved(false);
                setDraft({ ...draft, variation: Number(e.target.value) });
              }}
            />
            <p className="muted">
              Lower values keep siblings closer to the examples.
            </p>
          </div>
          {project.assetType !== "graphic" && (
            <div className="space-y-2">
              <Label htmlFor="workshop-effort">Preview effort</Label>
              <Select
                disabled={busy}
                value={draft.effort}
                onValueChange={(value) => {
                  setSaved(false);
                  setDraft({
                    ...draft,
                    effort: value as typeof draft.effort,
                  });
                }}
              >
                <SelectTrigger id="workshop-effort" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quick">
                    Quick · up to 1 draft correction
                  </SelectItem>
                  <SelectItem value="standard">
                    Standard · up to 3 draft corrections
                  </SelectItem>
                  <SelectItem value="thorough">
                    Thorough · up to 5 draft corrections
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="muted">
                Independent from judge rounds. All four modeling passes remain.
              </p>
            </div>
          )}
        </div>
        <fieldset className="space-y-3">
          <legend className="font-medium">
            Style examples · choose up to three saved versions
          </legend>
          {!examples.length && (
            <p className="muted">
              Completed material versions will appear here. Start with written
              style guidance.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {examples.map((v) => (
              <label key={v.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="workshop-checkbox"
                    checked={draft.exampleRunIds.includes(v.id)}
                    disabled={
                      busy ||
                      (!draft.exampleRunIds.includes(v.id) &&
                        draft.exampleRunIds.length >= 3)
                    }
                    onChange={(e) => {
                      setSaved(false);
                      setDraft({
                        ...draft,
                        exampleRunIds: e.target.checked
                          ? [...draft.exampleRunIds, v.id]
                          : draft.exampleRunIds.filter((id) => id !== v.id),
                      });
                    }}
                  />
                  <span>
                    {models.find((m) => m.id === v.modelId)?.name ||
                      "Saved asset"}{" "}
                    · iteration {v.iteration + 1}
                  </span>
                </div>
                {v.artifacts.renders?.[0] && (
                  <AssetImage
                    src={fileUrl(v.artifacts.renders[0])}
                    alt="Style example"
                  />
                )}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy}>
            {busy ? "Saving…" : "Save collection guidance"}
          </Button>
          {saved && <span role="status">Saved for future batches</span>}
        </div>
      </form>
    </Card>
  );
}
