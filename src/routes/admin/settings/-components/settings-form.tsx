import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { json, request } from "@/lib/client";
import type { RuntimeSettings } from "@/lib/contracts";
import { useEffect, useState, type FormEvent } from "react";

const timeoutFields = [
  ["agentMs", "Standard AI turn", "Planners, photographers, and judges"],
  ["builderMs", "Builder turn", "Complete builder turn and tool calls"],
  ["tanstackMs", "Direct AI request", "Brief and design requests"],
  ["imageMs", "Image generation", "Graphics, visual targets, and textures"],
  ["collectionMs", "Collection render", "One collection scene render"],
  ["analysisBlenderMs", "Analysis Blender import", "Geometry extraction subprocess"],
  ["analysisPythonMs", "Geometry analysis", "Deterministic Python analysis"],
] as const;

export function SettingsForm() {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    request<{ settings: RuntimeSettings }>("settings")
      .then(({ settings }) => setSettings(settings))
      .catch((cause) => setError(cause.message));
  }, []);

  const setTimeout = (key: keyof RuntimeSettings["timeouts"], value: number) =>
    setSettings((current) => current && ({
      ...current,
      timeouts: { ...current.timeouts, [key]: value },
    }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await request<{ settings: RuntimeSettings }>(
        "settings",
        json({
          timeouts: settings.timeouts,
          generationDefaults: settings.generationDefaults,
        }, "PATCH"),
      );
      setSettings(response.settings);
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!settings && !error)
    return <Card className="panel max-w-5xl" aria-label="Loading runtime settings">
      <Skeleton className="mb-5 h-6 w-48" />
      <Skeleton className="mb-3 h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </Card>;

  return (
    <form className="settings-stack" onSubmit={submit}>
      {error && <Alert variant="destructive" className="error">{error}</Alert>}
      {saved && <Alert className="border-[#d3e0bd] bg-[#e5efcf] text-[#466630]">Runtime settings saved.</Alert>}
      {settings && <>
        <Card className="panel settings-section">
          <div className="settings-section-heading">
            <div><span className="eyebrow">Execution</span><h2>Timeout coverage</h2></div>
            <p>New operations use these limits. Running work keeps the limit it started with.</p>
          </div>
          <div className="settings-grid">
            {timeoutFields.map(([key, label, help]) => (
              <Label key={key}>
                {label}<span>{help} · minutes</span>
                <Input type="number" min="1" max="1440" step="1" required
                  value={settings.timeouts[key] / 60_000}
                  onChange={(event) => setTimeout(key, Number(event.target.value) * 60_000)} />
              </Label>
            ))}
            <Label>
              Blender execution<span>One isolated builder script · minutes</span>
              <Input type="number" min="1" max="120" step="1" required
                value={settings.timeouts.blenderSeconds / 60}
                onChange={(event) => setTimeout("blenderSeconds", Number(event.target.value) * 60)} />
            </Label>
          </div>
        </Card>
        <Card className="panel settings-section">
          <div className="settings-section-heading">
            <div><span className="eyebrow">New batches</span><h2>Generation defaults</h2></div>
            <p>Pre-filled values only. Product limits remain 1–20 assets and 0–5 judge rounds.</p>
          </div>
          <div className="settings-grid">
            <Label>Asset count
              <Input type="number" min="1" max="20" required
                value={settings.generationDefaults.count}
                onChange={(event) => setSettings({ ...settings, generationDefaults: {
                  ...settings.generationDefaults, count: Number(event.target.value),
                }})} />
            </Label>
            <Label>Judge rounds
              <Input type="number" min="0" max="5" required
                value={settings.generationDefaults.judgeIterations}
                onChange={(event) => setSettings({ ...settings, generationDefaults: {
                  ...settings.generationDefaults, judgeIterations: Number(event.target.value),
                }})} />
            </Label>
            <Label>Graphic canvas
              <Select value={settings.generationDefaults.imageSize}
                onValueChange={(imageSize: RuntimeSettings["generationDefaults"]["imageSize"]) =>
                  setSettings({ ...settings, generationDefaults: { ...settings.generationDefaults, imageSize }})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1024x1024">Square</SelectItem>
                  <SelectItem value="1024x1536">Portrait</SelectItem>
                  <SelectItem value="1536x1024">Landscape</SelectItem>
                </SelectContent>
              </Select>
            </Label>
          </div>
        </Card>
        <div className="settings-save">
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save runtime settings"}</Button>
          <span>Credentials, paths, prompts, engines, and pipeline versions remain repository-managed.</span>
        </div>
      </>}
    </form>
  );
}
