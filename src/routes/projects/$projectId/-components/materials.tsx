import { describeError } from "@/lib/error-message";
import { useExportHistory } from "@/modules/asset-builds/use-export-history";
import {
  materialHistorySchema,
} from "@/modules/asset-builds/history";
import { MaterialViewer } from "../../../../components/material-viewer";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { MarkdownTextarea } from "@/components/markdown-textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CardsSkeleton } from "@/components/loading";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Download } from "lucide-react";
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
  ["calibration", "Reference response (wood/brick; 0 = off)", 0, 1, 0.1],
  ["moisture", "Moisture", 0, 1, 0.05],
  ["dirt", "Dirt deposits", 0, 1, 0.05],
  ["burial", "Particle burial", 0, 1, 0.05],
  ["sizeSpread", "Particle size variation", 0, 1, 0.05],
] as const;
type NumericField = (typeof numericFields)[number][0];
const fieldGroups: [string, NumericField[]][] = [
  ["Scale", ["tileMetres", "featureMm", "reliefMm"]],
  ["Surface", ["roughness", "coverage", "wear", "calibration"]],
  ["Weathering", ["moisture", "dirt", "burial", "sizeSpread"]],
];
const terminal = ["done", "failed", "cancelled"];

export function MaterialPanel({ projectId }: { projectId: string }) {
  const [parameters, setParameters] = useState<MaterialParameters>(() =>
    materialSchema.parse({}),
  );
  const [brief, setBrief] = useState("");
  const [reviewRounds, setReviewRounds] = useState(2),
    [parentId, setParentId] = useState<string>();
  const [comparison, setComparison] = useState<string>();
  const [exampleId, setExampleId] = useState("none");
  const {
    saved,
    loading,
    error: historyError,
    refresh,
    action: historyAction,
  } = useExportHistory(
    `projects/${projectId}/materials`,
    materialHistorySchema,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function generate(useBrief: boolean) {
    setBusy(true);
    setError("");
    try {
      const parsed = materialSchema.parse(parameters);
      await request(
        `projects/${projectId}/materials`,
        json({
          parameters: parsed,
          prompt: useBrief ? brief : "",
          reviewRounds,
          parentId: useBrief ? parentId : undefined,
          exampleIds: exampleId === "none" ? [] : [exampleId],
        }),
      );
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(path: string) {
    setError("");
    try {
      await historyAction(path);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const field = (name: NumericField) => {
    const [, label, min, max, step] = numericFields.find((f) => f[0] === name)!;
    return (
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
            setParameters({ ...parameters, [name]: Number(e.target.value) })
          }
        />
      </div>
    );
  };
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
        {(error || historyError) && (
          <Alert variant="destructive">
            <AlertDescription>{error || historyError}</AlertDescription>
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
          {field("seed")}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {fieldGroups.map(([title, names]) => (
            <fieldset key={title} className="idea-settings">
              <legend>{title}</legend>
              <div className="grid gap-3">{names.map(field)}</div>
            </fieldset>
          ))}
        </div>
        <p className="muted text-sm">
          Feature size controls grains, stones, grain bands or brick rows.
          Coverage controls gravel density or stone crack depth. Wear exposes
          paint chips on metal and adjusts roughness.
        </p>
        <div className="space-y-2">
          {parentId && (
            <p className="text-sm">
              Continuing selected material{" "}
              <Button variant="ghost" onClick={() => setParentId(undefined)}>
                Start new
              </Button>
            </p>
          )}
          <Label htmlFor="material-rounds">Review rounds</Label>
          <Input
            id="material-rounds"
            type="number"
            min={0}
            max={5}
            value={reviewRounds}
            onChange={(e) => setReviewRounds(Number(e.target.value))}
          />
          <Label htmlFor="material-brief">Optional material brief</Label>
          <MarkdownTextarea
            id="material-brief"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Coarse gray gravel with larger stones and deeper relief…"
            maxLength={12000}
          />
          <p className="muted text-sm">
            Generate from brief constructs a saved script and reviews final
            maps, recording usage in Activity & cost. Generate maps uses your
            settings directly.
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
          const previous =
            saved.find((v) => v.id === job.parentId) ||
            saved.find((v) => v.id !== job.id && v.status === "done");
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
                    {(job.error ? describeError(job.error) : "") ||
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
              {job.status === "done" && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setExampleId(exampleId === job.id ? "none" : job.id)
                  }
                >
                  {exampleId === job.id
                    ? "Clear style example"
                    : "Use as style example"}
                </Button>
              )}
              {job.status === "done" && (
                <div className="space-y-2">
                  <p>Review: {job.outcome || "unreviewed"}</p>
                  {job.review && <p>{job.review.assessment}</p>}
                  {job.review?.findings?.map(
                    (
                      finding: { feature: string; correction: string },
                      i: number,
                    ) => (
                      <p key={i}>
                        {finding.feature}: {finding.correction}
                      </p>
                    ),
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setParentId(job.id);
                      setParameters(materialSchema.parse(job.parameters));
                      setBrief("");
                    }}
                  >
                    Continue this material
                  </Button>
                </div>
              )}
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
              {previous && job.status === "done" && (
                <div className="space-y-3">
                  <Button
                    variant="outline"
                    onClick={() =>
                      setComparison(comparison === job.id ? undefined : job.id)
                    }
                  >
                    Compare saved versions
                  </Button>
                  {comparison === job.id && (
                    <div className="grid gap-3 md:grid-cols-2">
                      {[previous, job].map((version, index) => (
                        <figure key={version.id}>
                          <figcaption>
                            {index === 0
                              ? "Comparison version"
                              : "Current version"}
                            : {version.parameters?.recipe}, seed{" "}
                            {version.parameters?.seed},{" "}
                            {version.parameters?.tileMetres} m tile
                          </figcaption>
                          <img
                            className="w-full"
                            src={`${fileUrl(
                              version.files.find((f) =>
                                f.endsWith("/review.png"),
                              )!,
                            )}?w=1280`}
                            alt={`${index === 0 ? "Comparison" : "Current"} material review`}
                          />
                        </figure>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <MaterialViewer
                files={job.files}
                projectId={projectId}
                materialId={job.id}
              />
              {preview && (
                <a href={`${fileUrl(preview)}?w=1280`} target="_blank" rel="noreferrer">
                  <img
                    className="material-review"
                    src={`${fileUrl(preview)}?w=1280`}
                    alt="Material repeated under lighting, albedo crop, sphere and channel maps"
                    loading="lazy"
                  />
                </a>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="self-start">
                    <Download size={16} /> Downloads <ChevronDown size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {job.files.map((key: string) => (
                    <DropdownMenuItem key={key} asChild>
                      <a href={fileUrl(key)} download>
                        {key.split("/").pop()}
                      </a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </Card>
          );
        })
      )}
    </div>
  );
}
