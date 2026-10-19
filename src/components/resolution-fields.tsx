import { useId } from "react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { resolutionSchema, type Resolution } from "@/lib/contracts";
import type { AssetType } from "@/lib/asset-types";

export function resolutionFromForm(form: FormData) {
  const width = form.get("resolutionWidth");
  const height = form.get("resolutionHeight");
  return !width && !height ? null : resolutionSchema.parse({ width: Number(width), height: Number(height) });
}

export function ResolutionFields({ type, value, inherited = false }: { type: AssetType; value?: Resolution | null; inherited?: boolean }) {
  const id = useId();
  return <div className="space-y-2">
    <p className="text-sm font-medium">{inherited ? "Resolution override (optional)" : "Project resolution (optional)"}</p>
    <div className="grid grid-cols-2 gap-3">
      {(["width", "height"] as const).map((dimension) => <div key={dimension} className="space-y-2">
        <Label htmlFor={`${id}-${dimension}`}>{dimension === "width" ? "Width (px)" : "Height (px)"}</Label>
        <Input id={`${id}-${dimension}`} name={dimension === "width" ? "resolutionWidth" : "resolutionHeight"} type="number" min={4} max={type === "pixel" ? 128 : 8192} step={1} defaultValue={value?.[dimension] ?? ""} placeholder="Auto" />
      </div>)}
    </div>
    <p className="muted">{inherited ? "Leave both blank to use the project resolution. " : "Leave both blank to let generation choose. "}{type === "pixel" ? "4–128 pixels per dimension." : "Added to the prompt; the image provider may return a different size."}</p>
  </div>;
}
