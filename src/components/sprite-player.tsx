import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Label } from "./ui/label";
import { fileUrl } from "../lib/client";
type Cell = {
  x: number;
  y: number;
  width: number;
  height: number;
  direction: number;
  frame: number;
};
type Sheet = {
  fps: number;
  cells: Cell[];
  loop?: boolean;
  effectivePalette?: string[];
};

export function SpritePlayer({
  image,
  layout,
}: {
  image: string;
  layout: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sheet, setSheet] = useState<Sheet>(),
    [bitmap, setBitmap] = useState<HTMLImageElement>();
  const [direction, setDirection] = useState(0),
    [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(2),
    [background, setBackground] = useState("#e9ede8"),
    [view, setView] = useState("color"),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setSheet(undefined);
    setBitmap(undefined);
    setFrame(0);
    fetch(fileUrl(layout))
      .then((r) => {
        if (!r.ok) throw new Error("Cannot load sprite timing");
        return r.json();
      })
      .then((s) => {
        if (alive) setSheet(s);
      })
      .catch((e) => alive && setError(e.message));
    const img = new Image();
    img.onload = () => alive && setBitmap(img);
    img.onerror = () => alive && setError("Cannot load sprite sheet");
    img.src = fileUrl(image);
    return () => {
      alive = false;
    };
  }, [image, layout]);
  const cells = sheet?.cells.filter((c) => c.direction === direction) || [];
  useEffect(() => {
    if (!playing || !cells.length || !sheet) return;
    if (frame === cells.length - 1 && !sheet.loop) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => setFrame((f) => (f + 1) % cells.length),
      1000 / sheet.fps,
    );
    return () => clearTimeout(timer);
  }, [playing, cells.length, sheet, frame]);
  useEffect(() => {
    const cell = cells[Math.min(frame, cells.length - 1)],
      node = canvas.current;
    if (!cell || !node || !bitmap) return;
    node.width = cell.width;
    node.height = cell.height;
    const ctx = node.getContext("2d")!;
    ctx.clearRect(0, 0, node.width, node.height);
    ctx.drawImage(
      bitmap,
      cell.x,
      cell.y,
      cell.width,
      cell.height,
      0,
      0,
      cell.width,
      cell.height,
    );
    if (view !== "color") {
      const pixels = ctx.getImageData(0, 0, node.width, node.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const value =
          view === "silhouette"
            ? 32
            : Math.round(
                0.2126 * pixels.data[i] +
                  0.7152 * pixels.data[i + 1] +
                  0.0722 * pixels.data[i + 2],
              );
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      }
      ctx.putImageData(pixels, 0, 0);
    }
  }, [bitmap, sheet, direction, frame, view]);
  if (error) return <p role="alert">{error}</p>;
  const cell = cells[frame];
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div
        className="overflow-auto rounded p-3"
        style={{ background, maxWidth: "100%" }}
      >
        <canvas
          ref={canvas}
          aria-label={`Sprite direction ${direction}, source frame ${cell?.frame ?? "loading"}`}
          style={{
            imageRendering: "pixelated",
            width: (cell?.width || 64) * zoom,
            height: (cell?.height || 64) * zoom,
            display: "block",
            margin: "auto",
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => {
            if (frame === cells.length - 1) setFrame(0);
            setPlaying((p) => !p);
          }}
          disabled={!sheet}
        >
          {playing ? "Pause" : "Play"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setPlaying(false);
            setFrame((f) => (f + 1) % Math.max(1, cells.length));
          }}
        >
          Next frame
        </Button>
        <Label>
          Direction
          <Select
            value={String(direction)}
            onValueChange={(v) => {
              setDirection(Number(v));
              setFrame(0);
            }}
          >
            <SelectTrigger aria-label="Sprite direction">
              <SelectValue>{String(direction)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[...new Set(sheet?.cells.map((c) => c.direction))].map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        <Label>
          Zoom
          <Select
            value={String(zoom)}
            onValueChange={(v) => setZoom(Number(v))}
          >
            <SelectTrigger aria-label="Sprite zoom">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map((z) => (
                <SelectItem key={z} value={String(z)}>
                  {z}x
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        <Label>
          View
          <Select value={view} onValueChange={setView}>
            <SelectTrigger aria-label="Sprite inspection">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["color", "silhouette", "grayscale"].map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        <Button
          variant="outline"
          onClick={() =>
            setBackground((b) => (b === "#e9ede8" ? "#263238" : "#e9ede8"))
          }
        >
          Light / dark
        </Button>
      </div>
      <p className="text-sm">
        Frame {frame + 1}/{cells.length} · {sheet?.fps} FPS ·{" "}
        {sheet?.loop ? "Loop" : "One-shot"}
      </p>
      <div className="flex flex-wrap gap-1">
        {sheet?.effectivePalette?.map((c) => (
          <span
            key={c}
            title={c}
            aria-label={c}
            style={{ background: c, width: 18, height: 18 }}
            className="rounded border"
          />
        ))}
      </div>
    </div>
  );
}
