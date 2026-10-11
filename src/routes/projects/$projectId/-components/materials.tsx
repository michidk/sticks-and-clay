import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardsSkeleton } from "@/components/loading";
import { request, json, fileUrl } from "@/lib/client";
import {
  materialRecipes,
  materialSchema,
  type MaterialParameters,
} from "@/lib/materials";

const numericFields = [
  ["seed", "Seed", 0, 2147483647, 1],
  ["tileMetres", "Tile width (metres)", 0.1, 20, 0.1],
  ["featureMm", "Feature size (mm)", 0.5, 500, 0.5],
  ["reliefMm", "Height range (mm)", 0.1, 100, 0.1],
  ["roughness", "Roughness", 0.05, 1, 0.05],
  ["coverage", "Coverage", 0, 1, 0.05],
  ["wear", "Wear", 0, 1, 0.05],
] as const;
const terminal = ["done", "failed", "cancelled"];

export function MaterialPanel({ projectId }: { projectId: string }) {
  const [parameters, setParameters] = useState<MaterialParameters>(() =>
    materialSchema.parse({}),
  );
  const [brief, setBrief] = useState("");
  const [saved, setSaved] = useState<any[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const next = await request(`projects/${projectId}/materials`);
        if (active) {
          setSaved(next);
          setLoading(false);
          if (next.some((job: any) => !terminal.includes(job.status)))
            timer = setTimeout(load, 2500);
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [projectId, revision]);
  async function generate(useBrief: boolean) {
    setBusy(true);
    setError("");
    try {
      const parsed = materialSchema.parse(parameters);
      await request(
        `projects/${projectId}/materials`,
        json({ parameters: parsed, prompt: useBrief ? brief : "" }),
      );
      setRevision((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string) {
    setError("");
    try {
      await request(path, json({}));
      setRevision((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="material-workshop space-y-6">
      <Card className="space-y-4 p-5">
        <div>
          <h2>PBR materials</h2>
          <p className="muted">
            Make repeating surface maps with physical scale and a fixed seed.
            Inspect the repeated tile, sphere, crop and channels before using
            the material.
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="material-recipe">Recipe</Label>
            <Select
              value={parameters.recipe}
              onValueChange={(recipe) =>
                setParameters({
                  ...parameters,
                  recipe: recipe as MaterialParameters["recipe"],
                })
              }
            >
              <SelectTrigger id="material-recipe">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {materialRecipes.map((name) => (
                  <SelectItem value={name} key={name}>
                    {name.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="material-size">Resolution</Label>
            <Select
              value={String(parameters.size)}
              onValueChange={(size) =>
                setParameters({
                  ...parameters,
                  size: Number(size) as MaterialParameters["size"],
                })
              }
            >
              <SelectTrigger id="material-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[128, 256, 512, 1024].map((size) => (
                  <SelectItem value={String(size)} key={size}>
                    {size} × {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="material-color">Base color</Label>
            <Input
              id="material-color"
              value={parameters.color}
              onChange={(e) =>
                setParameters({ ...parameters, color: e.target.value })
              }
              placeholder="#80796b"
              maxLength={7}
            />
          </div>
          {numericFields.map(([name, label, min, max, step]) => (
            <div key={name} className="space-y-2">
              <Label htmlFor={`material-${name}`}>{label}</Label>
              <Input
                id={`material-${name}`}
                type="number"
                min={min}
                max={max}
                step={step}
                value={parameters[name]}
                onChange={(e) =>
                  setParameters({
                    ...parameters,
                    [name]: Number(e.target.value),
                  })
                }
              />
            </div>
          ))}
        </div>
        <p className="muted text-sm">
          Feature size controls grains, stones, grain bands or brick rows.
          Coverage controls gravel density or stone crack depth. Wear exposes
          paint chips on metal and adjusts roughness.
        </p>
        <div className="space-y-2">
          <Label htmlFor="material-brief">Optional material brief</Label>
          <Textarea
            id="material-brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Coarse gray gravel with larger stones and deeper relief…"
            maxLength={12000}
          />
          <p className="muted text-sm">
            Generate from brief uses an agent to choose supported recipe
            settings and records its usage in Activity & cost. Generate maps
            uses your settings directly.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void generate(false)}>
            {busy ? "Saving…" : "Generate maps"}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !brief.trim()}
            onClick={() => void generate(true)}
          >
            Generate from brief
          </Button>
        </div>
      </Card>
      {loading ? (
        <CardsSkeleton />
      ) : !saved.length ? (
        <p className="muted">
          No materials yet. Generate your first recipe above.
        </p>
      ) : (
        saved.map((job) => {
          const preview = job.files.find((key: string) =>
            key.endsWith("/review.png"),
          );
          return (
            <Card key={job.id} className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3>
                    {job.parameters?.recipe?.replaceAll("_", " ") || "Material"}{" "}
                    · seed {job.parameters?.seed}
                  </h3>
                  <p role="status" className="muted">
                    {job.error ||
                      (job.status === "done"
                        ? "Material maps ready"
                        : `Material: ${job.status}`)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {job.parameters && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setParameters(materialSchema.parse(job.parameters))
                      }
                    >
                      Use recipe
                    </Button>
                  )}
                  {!terminal.includes(job.status) && (
                    <Button
                      variant="outline"
                      onClick={() => void action(`queue/${job.id}/cancel`)}
                    >
                      Cancel
                    </Button>
                  )}
                  {job.status === "failed" && (
                    <Button
                      variant="outline"
                      onClick={() => void action(`queue/${job.id}/resume`)}
                    >
                      Resume
                    </Button>
                  )}
                </div>
              </div>
              {job.notes && <p>{job.notes}</p>}
              {job.validation && (
                <div className="text-sm">
                  <p>
                    Mean roughness: {job.validation.roughnessMean.toFixed(2)} ·
                    Maximum seam ratio:{" "}
                    {Math.max(
                      ...(Object.values(job.validation.seamRatios) as number[]),
                    ).toFixed(2)}
                  </p>
                  {job.validation.warnings.map((warning: string) => (
                    <p key={warning} className="text-amber-800">
                      {warning}
                    </p>
                  ))}
                </div>
              )}
              {preview && (
                <a href={fileUrl(preview)} target="_blank" rel="noreferrer">
                  <img
                    className="material-review"
                    src={fileUrl(preview)}
                    alt="Material repeated under lighting, albedo crop, sphere and channel maps"
                    loading="lazy"
                  />
                </a>
              )}
              <div className="flex flex-wrap gap-3">
                {job.files.map((key: string) => (
                  <a
                    className="underline"
                    key={key}
                    href={fileUrl(key)}
                    download
                  >
                    {key.split("/").pop()}
                  </a>
                ))}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
