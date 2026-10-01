import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { json, request } from "@/lib/client";
import type { RuntimeSettings } from "@/lib/contracts";
import { useEffect, useState, type FormEvent } from "react";

type Fields = {
  agent: string;
  builder: string;
  blender: string;
};

const toFields = (settings: RuntimeSettings): Fields => ({
  agent: String(settings.agentTimeoutMs / 60_000),
  builder: String(settings.builderTimeoutMs / 60_000),
  blender: String(settings.blenderBuildTimeoutSeconds / 60),
});

export function SettingsForm() {
  const [fields, setFields] = useState<Fields | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<{ settings: RuntimeSettings }>("settings")
      .then(({ settings }) => setFields(toFields(settings)))
      .catch((cause) => setError(cause.message));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!fields) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const agentMinutes = Number(fields.agent);
      const builderMinutes = Number(fields.builder);
      const blenderMinutes = Number(fields.blender);
      if (builderMinutes < blenderMinutes)
        throw new Error(
          "Builder timeout must be at least as long as one Blender execution.",
        );
      const response = await request<{ settings: RuntimeSettings }>(
        "settings",
        json(
          {
            agentTimeoutMs: agentMinutes * 60_000,
            builderTimeoutMs: builderMinutes * 60_000,
            blenderBuildTimeoutSeconds: blenderMinutes * 60,
          },
          "PUT",
        ),
      );
      setFields(toFields(response.settings));
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!fields && !error)
    return (
      <Card className="panel max-w-3xl" aria-label="Loading pipeline settings">
        <Skeleton className="mb-5 h-6 w-48" />
        <Skeleton className="mb-3 h-14 w-full" />
        <Skeleton className="mb-3 h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </Card>
    );

  return (
    <Card className="panel max-w-3xl">
      <div className="mb-7">
        <h2>Execution timeouts</h2>
        <p className="note mt-3">
          Saved values apply when the next AI turn or Blender execution starts.
          Work already in progress keeps the limit it started with.
        </p>
      </div>
      {error && (
        <Alert variant="destructive" className="error mb-5">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert className="mb-5 border-[#d3e0bd] bg-[#e5efcf] text-[#466630]">
          Pipeline settings saved.
        </Alert>
      )}
      {fields && (
        <form className="grid gap-6" onSubmit={submit}>
          <Label htmlFor="agent-timeout">
            Standard AI turn timeout
            <span className="font-normal text-muted-foreground">
              Used by planners, photographers, and judges. Minutes, 1–1,440.
            </span>
          </Label>
          <Input
            id="agent-timeout"
            type="number"
            min="1"
            max="1440"
            step="1"
            required
            value={fields.agent}
            onChange={(event) =>
              setFields({ ...fields, agent: event.target.value })
            }
          />
          <Label htmlFor="builder-timeout">
            Builder turn timeout
            <span className="font-normal text-muted-foreground">
              Covers the complete AI builder turn and all of its tool calls.
              Minutes, 1–1,440.
            </span>
          </Label>
          <Input
            id="builder-timeout"
            type="number"
            min="1"
            max="1440"
            step="1"
            required
            value={fields.builder}
            onChange={(event) =>
              setFields({ ...fields, builder: event.target.value })
            }
          />
          <Label htmlFor="blender-timeout">
            Blender execution timeout
            <span className="font-normal text-muted-foreground">
              Limit for one isolated builder script. Minutes, 1–120; it cannot
              exceed the builder timeout.
            </span>
          </Label>
          <Input
            id="blender-timeout"
            type="number"
            min="1"
            max="120"
            step="1"
            required
            value={fields.blender}
            onChange={(event) =>
              setFields({ ...fields, blender: event.target.value })
            }
          />
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save settings"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Existing sessions retain their model and prompt snapshots.
            </span>
          </div>
        </form>
      )}
    </Card>
  );
}
