import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { startingPointFormats, type StartingPoint } from "@/lib/starting-point";
import type { AssetType } from "@/lib/asset-types";
import { fileUrl } from "@/lib/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function StartingPointField({ type, source, file, run, units, removed, disabled, versions, onFile, onRun, onUnits, onRemove }: {
  type: AssetType; source?: StartingPoint; file: File | null; run: string; units: StartingPoint["units"]; removed: boolean; disabled: boolean;
  versions: { id: string; label: string }[]; onFile: (file: File | null) => void; onRun: (run: string) => void;
  onUnits: (units: StartingPoint["units"]) => void; onRemove: () => void;
}) {
  return <fieldset className="space-y-3 rounded-lg border p-4" disabled={disabled}>
    <legend className="px-1 text-sm font-medium">Starting point</legend>
    <p className="m-0 text-sm text-muted-foreground">Optional source to modify. Reference images below guide its appearance.</p>
    {source && !removed && !file && !run && <div className="flex flex-wrap items-center gap-2">
      <a className="break-all underline" href={fileUrl(source.key)} download>{source.name}</a>
      <Button type="button" variant="outline" size="sm" onClick={onRemove}>Remove starting point</Button>
      {source.mode === "reconstruct" && <p className="text-xs text-muted-foreground">This source will be reconstructed as editable {type === "cad" ? "CadQuery geometry" : "vector paths"}.</p>}
    </div>}
    <Label htmlFor="starting-file">Upload source</Label>
    <Input id="starting-file" type="file" accept={startingPointFormats[type].map((ext) => `.${ext}`).join(",")} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    {file && <p className="m-0 break-all text-sm">{file.name}</p>}
    {!!versions.length && <><Label htmlFor="starting-version">Or use a saved version</Label>
      <Select value={run || "none"} onValueChange={(value: string) => onRun(value === "none" ? "" : value)} disabled={disabled}>
        <SelectTrigger id="starting-version"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="none">Choose a version</SelectItem>{versions.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}</SelectContent>
      </Select></>}
    {(type === "cad" || type === "model") && <><Label htmlFor="starting-units">Source units (STL / OBJ)</Label>
      <Select value={units} onValueChange={onUnits} disabled={disabled}><SelectTrigger id="starting-units"><SelectValue /></SelectTrigger>
        <SelectContent>{["mm", "cm", "m", "in"].map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent></Select></>}
    <p className="m-0 text-xs text-muted-foreground">{startingPointFormats[type].join(", ")} · up to 200 MB; text files up to 8 MB. The source is frozen when generation starts.</p>
  </fieldset>;
}
