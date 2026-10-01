import { ModelChecks } from "./-components/checks";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Download,
  History as HistoryIcon,
  Layers,
  Image,
  FileText,
  Activity,
  ChevronRight,
  CircleCheck,
  CircleAlert,
  LoaderCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRegion } from "@/components/loading";
import { TriangleCount } from "@/components/triangle-count";
import { request, json, fileUrl, costSummary } from "@/lib/client";
import { History } from "../../-components/history";
import { ModelPipeline } from "./-components/pipeline";
import { ModelMedia } from "./-components/media";
import { ReviewNotes } from "./-components/review";
import {
  modelStatus,
  resolveVersion,
  versionLabel,
  type Workspace,
} from "./-lib/model";

const searchSchema = z.object({
  view: z.enum(["3d", "renders", "textures", "target"]).catch("3d"),
  section: z
    .enum(["review", "checks", "versions", "brief", "activity"])
    .catch("review"),
  version: z.string().uuid().optional().catch(undefined),
});
export const Route = createFileRoute("/projects/$projectId/models/$modelId/")({
  validateSearch: searchSchema,
  component: ModelPage,
});

function ModelPage() {
  const { projectId, modelId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Workspace>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setData(undefined);
    setError("");
    const refresh = async () => {
      try {
        const next = await request<Workspace>("projects/" + projectId);
        if (active) {
          setData(next);
          setError("");
        }
      } catch (error) {
        if (active) setError((error as Error).message);
      }
      if (active) timer = setTimeout(refresh, 3000);
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [projectId, modelId]);
  const updateSearch = (change: Partial<typeof search>) =>
    navigate({ search: { ...search, ...change }, resetScroll: false });
  const back = (
    <Link
      to="/projects/$projectId"
      params={{ projectId }}
      className="model-detail-back"
    >
      <ArrowLeft size={16} /> Back to collection
    </Link>
  );
  if (!data)
    return (
      <main className="model-detail-page">
        {back}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <LoadingRegion label="Opening model">
            <div className="model-detail-loading">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-5 w-1/3" />
              <div>
                <Skeleton className="h-[540px]" />
                <Skeleton className="h-[540px]" />
              </div>
            </div>
          </LoadingRegion>
        )}
      </main>
    );
  const model = data.models.find((item) => item.id === modelId);
  if (!model)
    return (
      <main className="model-detail-page">
        {back}
        <div className="model-detail-empty">
          <Boxes size={36} />
          <h1>Model not found</h1>
          <p>This model is not part of this project.</p>
        </div>
      </main>
    );
  const versions = data.versions.filter((item) => item.modelId === modelId);
  const selected = resolveVersion(model, versions, search.version);
  const artifacts = selected.artifacts;
  const checkedVersion =
    selected.version ||
    versions.find(
      (v) => v.artifacts?.glb && v.artifacts.glb === artifacts?.glb,
    );
  const runs = data.runs.filter((run) => run.modelId === modelId);
  const cost = runs.reduce((sum, run) => sum + (run.estimatedCost || 0), 0);
  const unpriced = runs.filter((run) => run.estimatedCost === null).length;
  const position = data.models.findIndex((item) => item.id === modelId);
  const statusClass =
    model.verdict === "limit_reached" ? "warning" : model.status;
  async function resume() {
    setBusy(true);
    setError("");
    try {
      await request("models/" + modelId + "/retry", json({}));
      setData(await request<Workspace>("projects/" + projectId));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="model-detail-page">
      <div className="model-detail-topline">
        {back}
        <nav
          aria-label="Models in collection"
          className="model-detail-pagination"
        >
          {data.models[position - 1] ? (
            <Link
              to="/projects/$projectId/models/$modelId"
              params={{ projectId, modelId: data.models[position - 1].id }}
              search={{ view: "3d", section: "review" }}
              aria-label="Previous model"
            >
              <ArrowLeft size={16} />
            </Link>
          ) : (
            <span aria-hidden="true">
              <ArrowLeft size={16} />
            </span>
          )}
          <span>
            {position + 1} of {data.models.length}
          </span>
          {data.models[position + 1] ? (
            <Link
              to="/projects/$projectId/models/$modelId"
              params={{ projectId, modelId: data.models[position + 1].id }}
              search={{ view: "3d", section: "review" }}
              aria-label="Next model"
            >
              <ArrowRight size={16} />
            </Link>
          ) : (
            <span aria-hidden="true">
              <ArrowRight size={16} />
            </span>
          )}
        </nav>
      </div>
      <header className="model-detail-heading">
        <div>
          <Link
            className="model-project-link"
            to="/projects/$projectId"
            params={{ projectId }}
          >
            {data.project.name}
            <ChevronRight size={14} />
          </Link>
          <h1>{model.name.replaceAll("_", " ")}</h1>
          <div className="model-detail-subtitle">
            <Badge variant="secondary" className={"badge " + statusClass}>
              {modelStatus(model)}
            </Badge>
            <span>
              {search.version
                ? selected.version
                  ? versionLabel(selected.version)
                  : "Unavailable version"
                : "Latest version"}
            </span>
            <span className="model-detail-filename">{model.name}</span>
          </div>
        </div>
        <div className="model-detail-downloads">
          <Button
            variant="outline"
            asChild={!!artifacts?.blend}
            disabled={!artifacts?.blend}
          >
            {artifacts?.blend ? (
              <a href={fileUrl(artifacts.blend)} download>
                <Download size={16} /> Blender source
              </a>
            ) : (
              <span>Blender source</span>
            )}
          </Button>
          <Button asChild={!!artifacts?.glb} disabled={!artifacts?.glb}>
            {artifacts?.glb ? (
              <a href={fileUrl(artifacts.glb)} download>
                <Download size={16} /> Download GLB
              </a>
            ) : (
              <span>Download GLB</span>
            )}
          </Button>
        </div>
      </header>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {selected.missing && (
        <Alert variant="destructive">
          <AlertDescription>
            This version is no longer available for this model.{" "}
            <Button
              variant="link"
              onClick={() => updateSearch({ version: undefined })}
            >
              View latest version
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div id="model-preview" className="model-detail-layout">
        <section className="model-detail-stage" aria-label="Model preview">
          <Tabs
            value={search.view}
            onValueChange={(value) =>
              updateSearch({ view: value as typeof search.view })
            }
          >
            <TabsList
              variant="line"
              className="model-media-tabs"
              aria-label="Model views"
            >
              <TabsTrigger value="3d">
                <Boxes size={16} />
                3D model
              </TabsTrigger>
              <TabsTrigger value="renders">
                <Image size={16} />
                Renders
              </TabsTrigger>
              <TabsTrigger value="textures">
                <Layers size={16} />
                Textures
              </TabsTrigger>
              <TabsTrigger value="target">
                <Image size={16} />
                Visual target
              </TabsTrigger>
            </TabsList>
            <TabsContent value={search.view}>
              <ModelMedia
                view={search.view}
                artifacts={artifacts}
                target={selected.target}
                name={model.name}
              />
            </TabsContent>
          </Tabs>
          <div className="model-stage-caption">
            <span>
              {artifacts?.stage === "geometry"
                ? "Geometry preview · final materials pending"
                : search.view === "target"
                  ? "Design reference · not a generated 3D model"
                  : "Inspect every detail, from every angle"}
            </span>
            <span>{artifacts?.glb ? "GLB" : "Preview"}</span>
          </div>
        </section>
        <aside className="model-detail-sidebar">
          <Card className="model-detail-panel">
            <div className="model-panel-title">
              <HistoryIcon size={16} />
              <h2>Version</h2>
            </div>
            <Select
              value={search.version || "latest"}
              onValueChange={(value) =>
                updateSearch({
                  version: value === "latest" ? undefined : value,
                })
              }
            >
              <SelectTrigger aria-label="Viewing version" className="w-full">
                <SelectValue placeholder="Choose version" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest">Latest version</SelectItem>
                {versions.map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    {versionLabel(version)} ·{" "}
                    {new Date(version.createdAt).toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="model-panel-hint">
              {selected.version
                ? new Date(selected.version.createdAt).toLocaleString()
                : selected.missing
                  ? "This version could not be found."
                  : "Showing the most recent model export."}
            </p>
            <dl className="model-detail-specs">
              <div>
                <dt>Triangles</dt>
                <dd>
                  <TriangleCount artifacts={artifacts} legend />
                </dd>
              </div>
              <div>
                <dt>Dimensions</dt>
                <dd>
                  {artifacts?.metrics?.dimensions
                    ?.map((value) => value.toFixed(2))
                    .join(" × ") || "—"}
                  {artifacts?.metrics?.dimensions && <small> meters</small>}
                </dd>
              </div>
              <div>
                <dt>Stage</dt>
                <dd>
                  {artifacts?.stage === "geometry"
                    ? "Geometry"
                    : artifacts?.stage === "surface"
                      ? "Materials"
                      : artifacts
                        ? "Complete"
                        : "Awaiting export"}
                </dd>
              </div>
            </dl>
          </Card>
          <Card
            className={
              "model-detail-panel model-review-card " +
              (selected.feedback?.passed ? "is-passed" : "")
            }
          >
            <div className="model-panel-title">
              {selected.feedback?.passed ? (
                <CircleCheck size={17} />
              ) : (
                <CircleAlert size={17} />
              )}
              <h2>Quality review</h2>
              {selected.feedback && (
                <strong>
                  {selected.feedback.score}
                  <small>/100</small>
                </strong>
              )}
            </div>
            <p>
              {selected.feedback
                ? selected.feedback.passed
                  ? "This version passed its judge review."
                  : "This version has changes to address. Read the review before using it."
                : "No judge review is recorded for this version."}
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                void updateSearch({ section: "review" });
                document
                  .getElementById("model-detail-notes")
                  ?.scrollIntoView({ block: "start" });
              }}
            >
              Read review <ArrowUpRight size={15} />
            </Button>
          </Card>
          <div className="model-detail-cost">
            <span>Model total estimate</span>
            <strong>{costSummary(cost)}</strong>
            <small>
              All attempts · {versions.length} build
              {versions.length === 1 ? "" : "s"}
              {unpriced ? ` · ${unpriced} request${unpriced === 1 ? "" : "s"} not yet priced` : ""}
            </small>
          </div>
          {model.error && (
            <Alert variant="destructive">
              <AlertDescription>{model.error}</AlertDescription>
            </Alert>
          )}
          {model.status === "failed" && (
            <Button variant="outline" onClick={resume} disabled={busy}>
              {busy && <LoaderCircle className="spin" size={16} />}
              {busy ? "Resuming…" : "Resume model"}
            </Button>
          )}
        </aside>
      </div>
      <ModelPipeline
        key={model.id}
        model={model}
        runs={runs}
        versions={versions}
        onInspect={(version, view, section) => {
          void updateSearch({ version, view, section });
          document
            .getElementById(
              section === "activity" ? "model-detail-notes" : "model-preview",
            )
            ?.scrollIntoView({ block: "start" });
        }}
      />
      <section id="model-detail-notes" className="model-detail-notes">
        <Tabs
          value={search.section}
          onValueChange={(value) =>
            updateSearch({ section: value as typeof search.section })
          }
        >
          <TabsList
            variant="line"
            className="model-notes-tabs"
            aria-label="Model details"
          >
            <TabsTrigger value="review">
              <CircleCheck size={16} />
              Review notes
            </TabsTrigger>
            <TabsTrigger value="checks">Analysis & cleanup</TabsTrigger>
            <TabsTrigger value="versions">
              <HistoryIcon size={16} />
              Version history <span>{versions.length}</span>
            </TabsTrigger>
            <TabsTrigger value="brief">
              <FileText size={16} />
              Build brief
            </TabsTrigger>
            <TabsTrigger value="activity">
              <Activity size={16} />
              Activity & cost
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value={search.section}
            className="model-detail-note-content"
          >
            {search.section === "review" && (
              <ReviewNotes review={selected.feedback} renders={artifacts?.renders} />
            )}
            {search.section === "checks" && (
              <ModelChecks
                artifacts={artifacts}
                judges={checkedVersion?.judges}
              />
            )}
            {search.section === "brief" && (
              <article className="model-detail-brief">
                <div className="eyebrow">THE BUILD REQUEST</div>
                <h2>A direction for every detail.</h2>
                <p>{model.prompt}</p>
              </article>
            )}
            {search.section === "activity" && (
              <History runs={runs} models={[model]} />
            )}
            {search.section === "versions" &&
              (versions.length ? (
                <div className="model-version-list">
                  {versions.map((version) => (
                    <article
                      key={version.id}
                      className={
                        version.id === search.version ? "is-selected" : ""
                      }
                    >
                      <div className="model-version-marker">
                        <HistoryIcon size={17} />
                      </div>
                      <div>
                        <div className="model-version-title">
                          <h3>{versionLabel(version)}</h3>
                          <Badge variant="outline">{version.status}</Badge>
                        </div>
                        <time>
                          {new Date(version.createdAt).toLocaleString()}
                        </time>
                        <p>
                          {version.summary ||
                            version.error ||
                            "No build summary was recorded."}
                        </p>
                        {!version.artifacts && (
                          <p className="muted">
                            No verified export saved for this attempt.
                          </p>
                        )}
                        <details className="my-4">
                          <summary className="cursor-pointer">
                            Analysis & cleanup
                          </summary>
                          <ModelChecks
                            artifacts={version.artifacts}
                            judges={version.judges}
                          />
                        </details>
                        {version.judges.length ? (
                          version.judges.map((judge) => (
                            <p key={judge.id} className="model-version-judge">
                              {judge.result
                                ? `Judge · ${judge.result.score}/100 · ${judge.result.passed ? "Passed" : "Changes requested"} — ${judge.result.summary}`
                                : `Judge · ${judge.status}${judge.error ? " — " + judge.error : ""}`}
                            </p>
                          ))
                        ) : (
                          <p className="muted">
                            No judge review for this attempt.
                          </p>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => {
                          void updateSearch({
                            version: version.id,
                            section: "review",
                          });
                          window.scrollTo({ top: 0 });
                        }}
                      >
                        Inspect version <ArrowUpRight size={15} />
                      </Button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="model-detail-empty">
                  <HistoryIcon size={30} />
                  <h3>No build history yet</h3>
                  <p>Each attempt will appear here as the model is built.</p>
                </div>
              ))}
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}
