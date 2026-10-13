import type { ModelInspection } from "@/components/ui/model-viewer/model-inspection";
import type { ObjectReference } from "@/lib/object-reference";
import { objectReferenceFromNode } from "./-lib/selection";
import { ModelChecks } from "./-components/checks";
import { queueKindLabels } from "@/lib/queue-view";
import { VersionActions } from "./-components/version-actions";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  ChevronDown,
  Download,
  History as HistoryIcon,
  Layers,
  Image,
  LoaderCircle,
} from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingRegion } from "@/components/loading";
import { TriangleCount } from "@/components/triangle-count";
import { LightboxProvider } from "@/components/image-lightbox";
import { request, json, fileUrl, costSummary } from "@/lib/client";
import { collectionAssetGroups } from "@/lib/project-summary";
import { History } from "../../-components/history";
import { ModelPipeline } from "./-components/pipeline";
import { ModelConversation } from "./-components/model-conversation";
import { ModelMedia } from "./-components/media";
import { ReviewNotes } from "./-components/review";
import {
  resolveVersion,
  versionLabel,
  type Workspace,
} from "./-lib/model";

const searchSchema = z.object({
  view: z.enum(["3d", "renders", "textures", "target"]).catch("3d"),
  section: z
    .enum(["review", "checks", "tools", "versions", "activity"])
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
  const [inspection, setInspection] = useState<{
    glb: string | undefined;
    value: ModelInspection;
  } | null>(null);
  const [objectReference, setObjectReference] = useState<ObjectReference | null>(null);
  const model = data?.models.find((item) => item.id === modelId);
  const versions = data?.versions.filter((item) => item.modelId === modelId) ?? [];
  const selected = model ? resolveVersion(model, versions, search.version) : undefined;
  const displayedGlb = selected?.artifacts?.glb;
  const reportInspection = useCallback((value: ModelInspection) => {
    setInspection({ glb: displayedGlb, value });
  }, [displayedGlb]);
  useEffect(() => {
    setObjectReference(null);
  }, [modelId, displayedGlb]);
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
    <Breadcrumbs
      items={[
        { label: "Projects", link: { to: "/" } },
        {
          label: data?.project.name || "Project",
          link: { to: "/projects/$projectId", params: { projectId } },
        },
      ]}
    />
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
  if (!model || !selected)
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
  const name = model.name.replaceAll("_", " ");
  const artifacts = selected.artifacts;
  const selectedObject = objectReference?.glb === artifacts?.glb ? objectReference : null;
  const checkedVersion =
    selected.version ||
    versions.find(
      (v) => v.artifacts?.glb && v.artifacts.glb === artifacts?.glb,
    );
  const runs = data.runs.filter((run) => run.modelId === modelId);
  const cost = runs.reduce((sum, run) => sum + (run.estimatedCost || 0), 0);
  const unpriced = runs.filter((run) => run.estimatedCost === null).length;
  // Paginate over collection entries so the count matches the project page.
  const groups = collectionAssetGroups(data.models);
  const position = groups.findIndex((group) =>
    group.assets.some((item) => item.id === modelId),
  );
  const neighbour = (offset: number) => groups[position + offset]?.representative;
  const moreFiles = [
    ...(artifacts?.sourceBundle
      ? [{ label: "Source bundle", key: artifacts.sourceBundle }]
      : []),
    ...(artifacts?.lods?.map((lod, index) => ({
      label: `LOD ${index + 1}`,
      key: lod.key,
    })) || []),
    ...(artifacts?.sprites
      ? [{ label: "Sprite sheet", key: artifacts.sprites.image }]
      : []),
  ];
  const stage = artifacts?.stage;
  const stageLabel =
    stage === "geometry"
      ? "Geometry"
      : stage === "surface"
        ? "Materials"
        : artifacts
          ? "Complete"
          : "Awaiting export";
  const stageHint =
    stage === "geometry"
      ? "Final materials pending"
      : stage === "surface"
        ? "Textured export"
        : artifacts
          ? "Published export"
          : "No files yet";
  const savedAt = (value: string) =>
    new Date(value).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const scrollToWorkbench = (target: "model-preview" | "model-detail-notes") =>
    document.getElementById(target)?.scrollIntoView({ block: "start" });
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
  const notice = (model.error || model.status === "failed") && (
    <div className="studio-chat-notice">
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
    </div>
  );
  return (
    <LightboxProvider>
      <main className="model-studio">
        <aside className="studio-chat" aria-label="Model conversation">
          <header className="studio-chat-head">
            <div className="model-detail-topline">
              <Breadcrumbs
                items={[
                  { label: "Projects", link: { to: "/" } },
                  {
                    label: data.project.name,
                    link: { to: "/projects/$projectId", params: { projectId } },
                  },
                ]}
              />
              <nav
                aria-label="Models in collection"
                className="model-detail-pagination"
              >
                {neighbour(-1) ? (
                  <Link
                    to="/projects/$projectId/models/$modelId"
                    params={{
                      projectId,
                      modelId: neighbour(-1)!.id,
                    }}
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
                  {position + 1} of {groups.length}
                </span>
                {neighbour(1) ? (
                  <Link
                    to="/projects/$projectId/models/$modelId"
                    params={{
                      projectId,
                      modelId: neighbour(1)!.id,
                    }}
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
            <h1>{name}</h1>
            <div className="model-detail-meta">
              <StatusBadge status={model.status} verdict={model.verdict} />
              {data.activeJobs?.filter((job) => job.modelId === model.id && job.kind !== "model").map((job) => (
                <StatusBadge key={job.id} status={job.status}>
                  {queueKindLabels[job.kind] || job.kind} · {job.status}
                </StatusBadge>
              ))}
              {model.name !== name && (
                <span className="model-detail-filename">{model.name}</span>
              )}
            </div>
          </header>
          <ModelConversation
            key={"story-" + model.id}
            projectId={projectId}
            model={model}
            workspace={data}
            versions={versions}
            selectedVersionId={checkedVersion?.id || search.version}
            objectReference={selectedObject}
            onClearObject={() => setObjectReference(null)}
            notice={notice}
            onInspect={(version) => {
              void updateSearch({ version, view: "3d" });
              scrollToWorkbench("model-preview");
            }}
            onReview={(version) => {
              void updateSearch({ version, section: "review" });
              scrollToWorkbench("model-detail-notes");
            }}
            onCreated={(id) =>
              void navigate({
                to: "/projects/$projectId/models/$modelId",
                params: { projectId, modelId: id },
                search: { view: "3d", section: "review" },
              })
            }
            onRefresh={async () =>
              setData(await request<Workspace>("projects/" + projectId))
            }
          />
        </aside>
        <section className="studio-preview" aria-label="Model preview">
          <Tabs
            value={search.view}
            onValueChange={(value) =>
              updateSearch({ view: value as typeof search.view })
            }
            className="studio-preview-tabs"
          >
            <div className="studio-preview-bar">
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
              <div className="studio-preview-tools">
                <Select
                  value={search.version || "latest"}
                  onValueChange={(value) =>
                    updateSearch({
                      version: value === "latest" ? undefined : value,
                    })
                  }
                >
                  <SelectTrigger
                    aria-label="Viewing version"
                    className="model-version-picker"
                  >
                    <HistoryIcon size={14} />
                    <SelectValue placeholder="Choose version" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="latest">Latest version</SelectItem>
                    {versions.map((version) => (
                      <SelectItem key={version.id} value={version.id}>
                        {versionLabel(version)} · {savedAt(version.createdAt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button asChild={!!artifacts?.glb} disabled={!artifacts?.glb}>
                  {artifacts?.glb ? (
                    <a href={fileUrl(artifacts.glb)} download>
                      <Download size={16} /> Download GLB
                    </a>
                  ) : (
                    <span>Download GLB</span>
                  )}
                </Button>
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
                {!!moreFiles.length && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" aria-label="More files to download">
                        More files <ChevronDown size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {moreFiles.map((file) => (
                        <DropdownMenuItem key={file.key} asChild>
                          <a href={fileUrl(file.key)} download>
                            <Download /> {file.label}
                          </a>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
            <div className="studio-preview-body">
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
              <div id="model-preview" className="model-detail-stage">
                <TabsContent value={search.view}>
                  <ModelMedia
                    view={search.view}
                    artifacts={artifacts}
                    target={selected.target}
                    name={model.name}
                    selectedMesh={selectedObject?.nodeId ?? null}
                    onInspect={reportInspection}
                    onSelectedMeshChange={(nodeId) => {
                      setObjectReference(
                        artifacts?.glb && checkedVersion?.status === "done"
                          ? objectReferenceFromNode(
                              artifacts.glb,
                              inspection?.glb === artifacts.glb ? inspection.value : null,
                              nodeId,
                            )
                          : null,
                      );
                    }}
                  />
                </TabsContent>
                <dl className="model-facts" aria-label="Version facts">
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
                      {artifacts?.metrics?.dimensions && <small>meters</small>}
                    </dd>
                  </div>
                  <div>
                    <dt>Stage</dt>
                    <dd>
                      {stageLabel}
                      <small>{stageHint}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>Version</dt>
                    <dd>
                      {selected.version
                        ? versionLabel(selected.version)
                        : selected.missing
                          ? "Unavailable"
                          : "Latest"}
                      <small>
                        {selected.version
                          ? `Saved ${savedAt(selected.version.createdAt)}`
                          : selected.missing
                            ? "This version could not be found"
                            : "Most recent model export"}
                      </small>
                    </dd>
                  </div>
                  <div>
                    <dt>Model estimate</dt>
                    <dd>
                      {costSummary(cost)}
                      <small>
                        {versions.length} build
                        {versions.length === 1 ? "" : "s"}
                        {unpriced
                          ? ` · ${unpriced} request${unpriced === 1 ? "" : "s"} not yet priced`
                          : " · all attempts"}
                      </small>
                    </dd>
                  </div>
                </dl>
              </div>
              <ModelPipeline
                key={"pipeline-" + model.id}
                model={model}
                runs={runs}
                versions={versions}
                onInspect={(version, view, section) => {
                  void updateSearch({ version, view, section });
                  scrollToWorkbench(
                    section === "activity"
                      ? "model-detail-notes"
                      : "model-preview",
                  );
                }}
              />
              <aside
                id="model-detail-notes"
                className="model-inspector"
                aria-label="Model details"
              >
                <Tabs
                  value={search.section}
                  onValueChange={(value) =>
                    updateSearch({ section: value as typeof search.section })
                  }
                >
                  <TabsList
                    variant="line"
                    className="model-inspector-tabs"
                    aria-label="Model detail sections"
                  >
                    <TabsTrigger value="review">Review</TabsTrigger>
                    <TabsTrigger value="checks">Analysis</TabsTrigger>
                    <TabsTrigger value="tools">Tools</TabsTrigger>
                    <TabsTrigger value="versions">
                      Versions <span>{versions.length}</span>
                    </TabsTrigger>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                  </TabsList>
                  <TabsContent
                    value={search.section}
                    className="model-inspector-content"
                  >
                    {search.section === "review" && (
                      <ReviewNotes
                        review={selected.feedback}
                        renders={artifacts?.renders}
                      />
                    )}
                    {search.section === "checks" && (
                      <ModelChecks
                        artifacts={artifacts}
                        judges={checkedVersion?.judges}
                      />
                    )}
                    {search.section === "tools" && (
                      <VersionActions
                        projectId={projectId}
                        modelId={modelId}
                        sourceRunId={
                          checkedVersion?.status === "done" &&
                          checkedVersion.artifacts?.blend
                            ? checkedVersion.id
                            : undefined
                        }
                        artifacts={artifacts}
                        review={selected.feedback}
                      />
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
                                version.id === search.version
                                  ? "is-selected"
                                  : ""
                              }
                            >
                              <div className="model-version-title">
                                <h3>{versionLabel(version)}</h3>
                                <StatusBadge status={version.status} />
                              </div>
                              <time dateTime={version.createdAt}>
                                {savedAt(version.createdAt)}
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
                              {version.judges.length ? (
                                version.judges.map((judge) => (
                                  <p
                                    key={judge.id}
                                    className="model-version-judge"
                                  >
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
                              <details>
                                <summary className="cursor-pointer">
                                  Analysis & cleanup
                                </summary>
                                <ModelChecks
                                  artifacts={version.artifacts}
                                  judges={version.judges}
                                />
                              </details>
                              <Button
                                variant="outline"
                                onClick={() => {
                                  void updateSearch({
                                    version: version.id,
                                    section: "review",
                                  });
                                  scrollToWorkbench("model-preview");
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
                          <p>
                            Attempts appear here as the model is built.
                          </p>
                        </div>
                      ))}
                  </TabsContent>
                </Tabs>
              </aside>
            </div>
          </Tabs>
        </section>
      </main>
    </LightboxProvider>
  );
}
