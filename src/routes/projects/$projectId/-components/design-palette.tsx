import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { generationPalettes, parsePaletteColors, withDesignPalette } from "@/lib/pixel-design-palette";

function Swatches({ colors }: { colors: string[] }) {
  return <ul className="flex flex-wrap gap-2" aria-label="Palette colors">
    {colors.map((color) => <li key={color} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-mono">
      <span className="size-6 shrink-0 rounded-sm border" style={{ backgroundColor: color }} aria-hidden="true" />
      {color}
    </li>)}
  </ul>;
}

export function DesignPalette({ design, version, onChange, disabled = false }: {
  design: string;
  version: number;
  onChange?: (design: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  let colors: string[] = [];
  let error = "";
  try { colors = [...new Set(generationPalettes(design).flatMap((palette) => palette.colors))]; }
  catch (e) { error = (e as Error).message; }
  let proposed: string[] = [];
  let inputError = "";
  try { proposed = parsePaletteColors(input); }
  catch (e) { inputError = (e as Error).message; }
  return <div className="space-y-3 border-b pb-4 mb-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3>Pixel palette · design v{version}</h3>
      {onChange && <Button variant="outline" size="sm" disabled={disabled} onClick={() => {
        setInput(colors.join(" "));
        setOpen(true);
      }}>{colors.length ? "Edit palette" : "Add palette"}</Button>}
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error} Edit the design document to correct its Pixel palette section.</p>
      : colors.length ? <Swatches colors={colors} />
      : <p className="muted">No fixed palette yet. Add colors or request a palette in the design chat.</p>}
    <p className="muted">Colors belong to this design revision. Earlier images may use different palettes.</p>
    {onChange && <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pixel palette</DialogTitle>
          <DialogDescription>Choose up to 64 colors for this collection. Each sprite uses up to 32. Apply, then save and approve the design to use these colors for new generation.</DialogDescription>
        </DialogHeader>
        <Label htmlFor="pixel-palette-colors">Hex colors</Label>
        <Textarea id="pixel-palette-colors" value={input} placeholder="#1a1c2c #38b764 #ffcd75" className="max-h-40 font-mono"
          onChange={(event) => setInput(event.target.value)} aria-invalid={Boolean(inputError)} aria-describedby="pixel-palette-help" />
        <p id="pixel-palette-help" className="text-sm text-muted-foreground">{inputError || `${proposed.length} colors. Separate values with spaces, commas, or new lines.`}</p>
        {!!proposed.length && <Swatches colors={proposed} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={disabled || Boolean(inputError) || Boolean(error)} onClick={() => {
            onChange(withDesignPalette(design, proposed));
            setOpen(false);
          }}>Apply palette</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>}
  </div>;
}
