import { useExportHistory } from "@/modules/asset-builds/use-export-history";
import {
  exportHistorySchema,
  type ExportHistory,
} from "@/modules/asset-builds/history";
import { useEffect, useState } from "react";
import { SpritePlayer } from "@/components/sprite-player";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { request, json, fileUrl } from "@/lib/client";
import { spriteOptionsSchema, type SpriteOptions } from "@/lib/sprites";

export function SpriteExport({
  modelId,
  sourceRunId,
}: {
  modelId: string;
  sourceRunId?: string;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [options, setOptions] = useState<SpriteOptions>(() =>
    spriteOptionsSchema.parse({}),
  );
  const [palette, setPalette] = useState("");
  const [clips, setClips] = useState<{ name: string; index: number }[]>([]);
  useEffect(() => {
    if (!open || !sourceRunId) return;
    let active = true;
    request<{ name: string; index: number }[]>(
      `models/${modelId}/sprite-clips?sourceRunId=${sourceRunId}`,
    )
      .then((value) => {
        if (active) setClips(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [open, modelId, sourceRunId]);
  const {
    saved: history,
    error: historyError,
    refresh,
    action: historyAction,
  } = useExportHistory(`models/${modelId}/workshop-jobs`, exportHistorySchema);
  const saved = history.filter((job) => job.sourceRunId === sourceRunId);
  async function generate() {
    setBusy(true);
    setError("");
    try {
      const spriteOptions = spriteOptionsSchema.parse({
        ...options,
        palette: palette.trim()
          ? palette.split(/[\s,]+/).filter(Boolean)
          : undefined,
      });
      await request(
        `models/${modelId}/presentation`,
        json({ sourceRunId, sprites: true, spriteOptions }),
      );
      setOpen(false);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string) {
    try {
      await historyAction(path);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={!sourceRunId || busy}
        onClick={() => {
          setError("");
          setOpen(true);
        }}
      >
        Export 3D sprites
      </Button>
      {error && !open && (
        <Alert variant="destructive">
          <AlertDescription>{error || historyError}</AlertDescription>
        </Alert>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sprite-export-dialog">
          <DialogHeader>
            <DialogTitle>Sprites from 3D</DialogTitle>
            <DialogDescription>
              Render this saved model with an orthographic camera. Pixel mode
              uses consistent lighting, a shared palette, hard transparency and
              an optional outline.
            </DialogDescription>
          </DialogHeader>
          {(error || historyError) && (
            <Alert variant="destructive">
              <AlertDescription>{error || historyError}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="workshop-issue">
              <input
                className="workshop-checkbox"
                type="checkbox"
                checked={options.pixel}
                onChange={(e) =>
                  setOptions({ ...options, pixel: e.target.checked })
                }
              />
              <span>Pixel art</span>
            </label>
            {[
              ["directions", "Directions", [1, 4, 8]],
              ["size", "Cell size", [32, 64, 128, 256]],
            ].map(([key, label, values]) => (
              <div key={key as string} className="space-y-2">
                <Label htmlFor={`sprite-${key}`}>{label as string}</Label>
                <Select
                  value={String(options[key as "directions" | "size"])}
                  onValueChange={(value) =>
                    setOptions({ ...options, [key as string]: Number(value) })
                  }
                >
                  <SelectTrigger id={`sprite-${key}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(values as number[]).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {(
              [
                ["frameCount", "Frames", 1, 16],
                ["fps", "Frames per second", 1, 60],
                ["colors", "Palette colors", 2, 32],
                ["elevation", "Camera elevation", 0, 90],
                ["zoom", "Camera zoom", 0.5, 2],
                ["padding", "Padding", 0, 0.3],
              ] as const
            ).map(([key, label, min, max]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`sprite-${key}`}>{label}</Label>
                <Input
                  id={`sprite-${key}`}
                  type="number"
                  min={min}
                  max={max}
                  step={key === "zoom" || key === "padding" ? 0.01 : 1}
                  value={options[key]}
                  disabled={key === "colors" && !options.pixel}
                  onChange={(e) =>
                    setOptions({ ...options, [key]: Number(e.target.value) })
                  }
                />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="sprite-clip">Animation clip</Label>
            <Select
              value={options.clip || "__active"}
              onValueChange={(clip) =>
                setOptions({
                  ...options,
                  clip: clip === "__active" ? "" : clip,
                })
              }
            >
              <SelectTrigger id="sprite-clip">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__active">Active animation</SelectItem>
                {clips.map((c) => (
                  <SelectItem key={c.index} value={`@animation:${c.index}`}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={options.loop}
                className="h-4 w-4 shrink-0 accent-primary"
                onChange={(e) =>
                  setOptions({ ...options, loop: e.target.checked })
                }
              />
              Loop animation (exclude repeated endpoint)
            </label>
            <Label>Pivot anchor</Label>
            <Select
              value={options.anchor}
              onValueChange={(anchor) =>
                setOptions({
                  ...options,
                  anchor: anchor as "ground" | "center",
                })
              }
            >
              <SelectTrigger aria-label="Pivot anchor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ground">Ground</SelectItem>
                <SelectItem value="center">Center</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sprite-palette">Custom palette (optional)</Label>
            <Input
              id="sprite-palette"
              disabled={!options.pixel}
              value={palette}
              onChange={(e) => setPalette(e.target.value)}
              placeholder="#314434 #cfab72 #eee6d2"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sprite-outline">Outline color (optional)</Label>
            <Input
              id="sprite-outline"
              disabled={!options.pixel}
              value={options.outline}
              onChange={(e) =>
                setOptions({ ...options, outline: e.target.value })
              }
              placeholder="#243b2c"
              maxLength={7}
            />
          </div>
          <p className="muted text-sm">
            Animation frames use the exported timeline. The sheet and source
            bundle include cell positions, direction angles and timing. Export
            makes no agent request.
          </p>
          <Button disabled={busy} onClick={() => void generate()}>
            {busy ? "Saving…" : "Render sprites"}
          </Button>
        </DialogContent>
      </Dialog>
      {!!saved.length && (
        <div className="w-full space-y-3">
          {saved.map((job) => {
            const image = job.files.find((key: string) =>
              key.endsWith("/sprites.png"),
            );
            return (
              <div key={job.id} className="space-y-2 rounded-md border p-3">
                <p role="status">
                  {job.error ||
                    (job.status === "done"
                      ? "Saved export ready"
                      : `Export: ${job.status}`)}
                </p>
                {image &&
                  job.files.find((key: string) =>
                    key.endsWith("/sprites.json"),
                  ) && (
                    <SpritePlayer
                      image={image}
                      layout={job.files.find((key: string) =>
                        key.endsWith("/sprites.json"),
                      )!}
                    />
                  )}
                {image && (
                  <a href={fileUrl(image)} target="_blank" rel="noreferrer">
                    <img
                      className="sprite-review"
                      src={fileUrl(image)}
                      alt="Rendered directions and animation frames"
                      loading="lazy"
                    />
                  </a>
                )}
                <div className="flex flex-wrap gap-3">
                  {job.files.map((key: string) => (
                    <a
                      className="underline"
                      href={fileUrl(key)}
                      key={key}
                      download
                    >
                      {key.split("/").pop()}
                    </a>
                  ))}
                </div>
                {job.status === "failed" && (
                  <Button
                    variant="outline"
                    onClick={() => void action(`queue/${job.id}/resume`)}
                  >
                    Resume
                  </Button>
                )}
                {!["done", "failed", "cancelled"].includes(job.status) && (
                  <Button
                    variant="outline"
                    onClick={() => void action(`queue/${job.id}/cancel`)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
