import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { request, json } from "@/lib/client";
import { editPixelCanvas, pixelEditInput } from "@/lib/pixel-edit";
import { pixelGridSchema, resolvePixelAnswer, type PixelGrid } from "@/lib/pixel";
import type { z } from "zod";

type Edit = z.infer<typeof pixelEditInput>["edits"][number];

export function PixelEditor({ modelId, projectId, sourceRunId }: { modelId: string; projectId: string; sourceRunId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [original, setOriginal] = useState<PixelGrid>(), [edits, setEdits] = useState<Edit[]>([]);
  const [color, setColor] = useState(""), [target, setTarget] = useState("base");
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const grid = useMemo(() => original ? editPixelCanvas(original, edits) : undefined, [original, edits]);
  const frame = /^frame (\d+)$/.exec(target);
  const rows = !grid ? [] : target === "base" ? grid.rows : frame ? grid.frames?.[Number(frame[1]) - 2]?.rows ?? [] : grid.layers?.find(layer => layer.name === target)?.rows ?? [];
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !grid) return;
    context.clearRect(0, 0, grid.width, grid.height);
    const palette = new Map(grid.palette.map(entry => [entry.key, entry.color]));
    rows.forEach((row, y) => [...row].forEach((key, x) => {
      const color = palette.get(key);
      if (!color || color === "transparent") return;
      context.fillStyle = color;
      context.fillRect(x, y, 1, 1);
    }));
  }, [grid, rows]);
  async function load() {
    setOpen(true); setBusy(true); setError(""); setOriginal(undefined); setEdits([]); setTarget("base");
    try {
      const data: unknown = await request(`asset-versions/${modelId}/pixels?sourceRunId=${sourceRunId}`);
      const saved = resolvePixelAnswer(pixelGridSchema.parse(data));
      setOriginal(saved); setColor(saved.palette.find(entry => entry.color !== "transparent")?.key ?? saved.palette[0].key);
    } catch (error) { setError(error instanceof Error ? error.message : "Cannot load pixels"); }
    finally { setBusy(false); }
  }
  function paint(x: number, y: number, erase = false) {
    if (!grid || busy) return;
    setCursor({ x, y });
    const key = erase ? grid.palette.find(entry => entry.color === "transparent" || /^#[0-9a-f]{6}00$/i.test(entry.color))?.key : color;
    if (!key) { setError("This saved palette has no transparent color."); return; }
    if (rows[y]?.[x] === key) return;
    setEdits(current => [...current, { x, y, key, target }]);
  }
  async function save() {
    setBusy(true); setError("");
    try {
      // Collapse repeated painting of the same cell before crossing the API boundary.
      const cells = new Map(edits.map(edit => [`${edit.target}:${edit.x}:${edit.y}`, edit]));
      const response = await request<{ id: string }>(`asset-versions/${modelId}/pixels`, json({ sourceRunId, edits: [...cells.values()] }));
      setOpen(false);
      await navigate({ to: "/projects/$projectId/models/$modelId", params: { projectId, modelId: response.id }, search: { view: "3d", section: "review" } });
    } catch (error) { setError(error instanceof Error ? error.message : "Cannot save pixels"); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="outline" onClick={() => void load()}>Edit pixels</Button>
    <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Edit pixels</DialogTitle><DialogDescription>Save as a new Version. The original stays intact. Use Iterate on the saved Version to continue with AI.</DialogDescription></DialogHeader>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {busy && !grid && <p role="status">Loading pixels…</p>}
        {grid && <>
          <div className="flex flex-wrap gap-2" aria-label="Palette">
            {grid.palette.map(entry => <Button key={entry.key} variant={entry.key === color ? "default" : "outline"} size="sm" aria-pressed={entry.key === color} aria-label={`Paint ${entry.key}: ${entry.color}`} onClick={() => setColor(entry.key)}>
              <span className="size-4 rounded-sm border" style={{ backgroundColor: entry.color === "transparent" ? "transparent" : entry.color }} />{entry.key}
            </Button>)}
          </div>
          {(grid.frames?.length || grid.layers?.length) ? <div className="space-y-2"><Label htmlFor="pixel-editor-target">Frame or layer</Label><Select value={target} onValueChange={setTarget}><SelectTrigger id="pixel-editor-target"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="base">{grid.frames?.length ? "Frame 1" : "Base layer"}</SelectItem>
            {grid.frames?.map((_, index) => <SelectItem key={index} value={`frame ${index + 2}`}>Frame {index + 2}</SelectItem>)}
            {grid.layers?.map(layer => <SelectItem key={layer.name} value={layer.name}>{layer.name}</SelectItem>)}
          </SelectContent></Select></div> : null}
          <p id="pixel-editor-help" className="muted">Click or drag to paint. Right-click to erase. Keyboard: arrows move, Space paints, Delete erases. Cell {cursor.x + 1}, {cursor.y + 1}. {grid.width}×{grid.height} pixels.</p>
          <canvas ref={canvas} width={grid.width} height={grid.height} tabIndex={0} aria-label="Pixel drawing canvas" aria-describedby="pixel-editor-help"
            className="mx-auto w-full max-w-[448px] touch-none border bg-secondary focus-visible:outline-2 focus-visible:outline-primary"
            style={{ imageRendering: "pixelated", aspectRatio: `${grid.width}/${grid.height}` }}
            onContextMenu={event => event.preventDefault()}
            onPointerDown={event => {
              event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
              const box = event.currentTarget.getBoundingClientRect();
              paint(Math.min(grid.width - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * grid.width))), Math.min(grid.height - 1, Math.max(0, Math.floor((event.clientY - box.top) / box.height * grid.height))), event.button === 2);
            }}
            onPointerMove={event => {
              if (!event.buttons) return;
              const box = event.currentTarget.getBoundingClientRect();
              paint(Math.min(grid.width - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * grid.width))), Math.min(grid.height - 1, Math.max(0, Math.floor((event.clientY - box.top) / box.height * grid.height))), Boolean(event.buttons & 2));
            }}
            onKeyDown={event => {
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Delete", "Backspace"].includes(event.key)) event.preventDefault();
              if (event.key === " " || event.key === "Delete" || event.key === "Backspace") paint(cursor.x, cursor.y, event.key !== " ");
              else setCursor(current => ({ x: Math.max(0, Math.min(grid.width - 1, current.x + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0))), y: Math.max(0, Math.min(grid.height - 1, current.y + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0))) }));
            }} />
          <div className="flex gap-2"><Button variant="outline" disabled={busy || !edits.length} onClick={() => setEdits(current => current.slice(0, -1))}>Undo</Button><Button variant="outline" disabled={busy || !edits.length} onClick={() => setEdits([])}>Reset</Button></div>
        </>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={busy || !edits.length} onClick={() => void save()}>{busy ? "Saving…" : "Save new Version"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
