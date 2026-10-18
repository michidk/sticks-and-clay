import { z } from "zod";
import { ModelViewer } from "@/components/ui/model-viewer/lazy";
import { Button } from "@/components/ui/button";
import { fileUrl } from "@/lib/client";
import { AssetImage } from "@/components/asset-image";

const schema = z.record(z.string(), z.string());
const labels: Record<string, string> = { script: "CadQuery source", step: "STEP", stl: "STL", glb: "GLB", source: "Source bundle", metrics: "Measurements", manifest: "Manifest", inputStep: "Input STEP" };
const viewSchema = z.array(z.object({ key: z.string(), label: z.string() }));
const metricSchema = z.object({ dimensionsMm: z.object({ x: z.number(), y: z.number(), z: z.number() }), solidCount: z.number(),
  checks: z.array(z.object({ name: z.string(), state: z.string(), actual: z.number().nullable() })) });
export function CadExports({ exports, previews, analysis }: { exports: unknown; previews: unknown; analysis: unknown }) {
  const parsed = schema.safeParse(exports);
  const views = viewSchema.safeParse(previews), metrics = metricSchema.safeParse(analysis);
  if (!parsed.success) return null;
  return <section className="mt-6 space-y-4" aria-label="CAD outputs">
    <h2>CAD model</h2>
    {parsed.data.glb && <ModelViewer src={fileUrl(parsed.data.glb)} height={420} />}
    <p className="text-sm text-muted-foreground">Dimensions are authored in millimetres. STEP is the CAD geometry; STL and GLB are tessellated exports.</p>
    {metrics.success && <div className="space-y-2 rounded-lg border p-3">
      <p className="m-0 text-sm">{Object.entries(metrics.data.dimensionsMm).map(([axis, value]) => `${axis.toUpperCase()} ${value.toFixed(2)} mm`).join(" · ")} · {metrics.data.solidCount} solids</p>
      <ul className="m-0 space-y-1 text-sm">{metrics.data.checks.map((check, i) => <li key={i}>{check.name}: {check.state}{check.actual !== null ? ` (${check.actual.toFixed(3)})` : ""}</li>)}</ul>
    </div>}
    <div className="flex flex-wrap gap-2">{Object.entries(labels).flatMap(([id, label]) => parsed.data[id] ? [
      <Button key={id} asChild variant="outline" size="sm"><a href={fileUrl(parsed.data[id])} download>{label}</a></Button>,
    ] : [])}</div>
    {views.success && <><h2>Review views</h2><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {views.data.map((view) => <a key={view.key} href={fileUrl(view.key)} target="_blank" rel="noreferrer" className="rounded-lg border p-2">
        <AssetImage src={fileUrl(view.key)} width={640} alt={view.label} className="aspect-square w-full rounded" />
        <p className="m-0 text-xs text-muted-foreground">{view.label}</p>
      </a>)}
    </div></>}
  </section>;
}
