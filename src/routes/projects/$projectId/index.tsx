import { GenerationDialog } from "./-components/generation-dialog";
import { ModelIdeas } from "./-components/model-ideas";
import { DesignMockupStep } from "./-components/design-mockups";
import { DesignReference } from "./-components/design-reference";
import { AssetCard } from "./-components/asset-card";
import {
  collectionAssetGroups,
  collectionSummary,
  projectState,
} from "@/lib/project-summary";
import { ProjectSetup } from "./-components/project-setup";
import { ImportModel } from "./-components/import-model";
import { WorkerNotice } from "@/components/worker-notice";
import { WorkshopPanel } from "./-components/workshop";
import { MaterialPanel } from "./-components/materials";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspaceSkeleton } from "@/components/loading";
import { AssetImage } from "@/components/asset-image";
import { LightboxProvider } from "@/components/image-lightbox";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { StatusBadge } from "@/components/status";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { z } from "zod";
import { Plus } from "lucide-react";
import { request, json, costSummary, fileUrl } from "../../../lib/client";
import { PendingModel } from "./-components/pending-model";
import { failedBatchFor, pendingCollectionItems } from "./-lib/collection";
import { History } from "./-components/history";
import { queueKindLabels } from "@/lib/queue-view";

const tabs = [
  "ideas",
  "models",
  "design",
  "mockups",
  "style",
  "materials",
  "history",
] as const;
export type ProjectTab = (typeof tabs)[number];
export const Route = createFileRoute("/projects/$projectId/")({
  validateSearch: z.object({ tab: z.enum(tabs).optional().catch(undefined) }),
  component: ProjectPage,
});
const finished = ["done", "failed", "cancelled"];
function ProjectPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<any>(),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [generate, setGenerate] = useState(false),
    [busy, setBusy] = useState(false),
    [previewModelId, setPreviewModelId] = useState<string | null>(null);
  const setTab = (tab: ProjectTab) =>
    navigate({ search: { tab }, resetScroll: false });
  async function load() {
    const d = await request(`projects/${projectId}?summary=true`);
    setData(d);
    return d;
  }
  useEffect(() => {
    setData(undefined);
    setPreviewModelId(null);
    setFilter("all");
    setQuery("");
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = () =>
      request(`projects/${projectId}?summary=true`, { signal: controller.signal })
        .then((d) => {
          if (active) {
            setData(d);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) timer = setTimeout(refresh, 2500);
        });
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectId]);
  if (!data)
    return (
      <main>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <WorkspaceSkeleton />
        )}
      </main>
    );
  const p = data.project,
    rs = data.runs;
  const isGraphics = p.assetType === "graphic";
  const assetPlural = isGraphics ? "graphics" : "models";
  const assetSingular = isGraphics ? "graphic" : "model";
  const ready = p.status === "ready";
  if (!["ready", "review"].includes(p.status)) {
    return (
      <ProjectSetup
        project={p}
        error={error}
        retrying={busy}
        onRetry={async () => {
          setBusy(true);
          setError("");
          try {
            await request(`projects/${projectId}/retry-design`, json({}));
            await load();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }
  const total = rs.reduce(
    (a: any, r: any) => ({
      cost: a.cost + (r.estimatedCost || 0),
      unpriced: a.unpriced + (r.estimatedCost === null ? 1 : 0),
    }),
    { cost: 0, unpriced: 0 },
  );
  const collection = collectionSummary(data.models, data.batches);
  const modelGroups = collectionAssetGroups(data.models);
  const collectionModels = modelGroups.map((group) => group.representative);
  const modelGroupByRepresentative = new Map(
    modelGroups.map((group) => [group.representative.id, group]),
  );
  const activeWork = data.activeJobs?.find((job: any) => job.kind !== "model");
  const designUpdating = data.activeJobs?.some((job: any) => ["design", "design-from-model", "design-update"].includes(job.kind)) || false;
  const state = activeWork
    ? { label: `${queueKindLabels[activeWork.kind] || activeWork.kind} · ${activeWork.status}`, tone: activeWork.status === "queued" ? "queued" : "running" }
    : projectState(p.status, collection);
  const pending = pendingCollectionItems(data.batches, data.models);
  // Collection renders that failed after the models existed belong on those models' cards.
  const renderFailureByRepresentative = new Map(
    modelGroups.map((group) => [
      group.representative.id,
      failedBatchFor(data.batches, group.assets),
    ]),
  );
  const needsAttention = (m: any) =>
    m.verdict === "limit_reached" ||
    m.status === "failed" ||
    Boolean(renderFailureByRepresentative.get(m.id));
  const ideas = data.ideas || [];
  const counts = {
    all: collectionModels.length + pending.length,
    working:
      collectionModels.filter((m: any) => !finished.includes(m.status)).length +
      pending.filter((item) => item.batch.status !== "failed").length,
    attention:
      collectionModels.filter(needsAttention).length +
      pending.filter((item) => item.batch.status === "failed").length,
    finished: collectionModels.filter((m: any) => m.status === "done").length,
  };
  const matches = (text: string) =>
    text.toLowerCase().includes(query.toLowerCase().trim());
  const visibleModels = collectionModels.filter(
    (m: any) =>
      matches(m.name + " " + m.prompt) &&
      (filter === "all" ||
        (filter === "working"
          ? !finished.includes(m.status)
          : filter === "attention"
            ? needsAttention(m)
            : m.status === "done")),
  );
  const visiblePending = pending.filter(
    (item) =>
      matches(item.batch.prompt) &&
      (filter === "all" ||
        (filter === "working" && item.batch.status !== "failed") ||
        (filter === "attention" && item.batch.status === "failed")),
  );
  async function resumeBatch(id: string) {
    setBusy(true);
    setError("");
    try {
      await request("batches/" + id + "/resume", json({}));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Unapproved projects open on the design; mockups need an approved version.
  const activeTab: ProjectTab =
    !ready && (!search.tab || search.tab === "mockups")
      ? "design"
      : search.tab === "ideas" && !ideas.length
        ? "models"
        : search.tab || "models";
  const hasCollection = data.models.length || data.batches.length;
  const tabList: [ProjectTab, string, number?][] = [
    ...(ideas.length ? [["ideas", "Ideas", ideas.length] as [ProjectTab, string, number]] : []),
    ["models", isGraphics ? "Graphics" : "Models", counts.all],
    ["design", "Design"],
    ...(ready ? [["mockups", "Mockups"] as [ProjectTab, string]] : []),
    ["style", "Style"],
    ...(!isGraphics && ready
      ? [["materials", "Materials"] as [ProjectTab, string]]
      : []),
    ["history", "Activity", rs.length],
  ];
  return (
    <main className="project-overview">
      <Breadcrumbs
        items={[{ label: "Projects", link: { to: "/" } }, { label: p.name }]}
      />
      <section className="page-header">
        <div>
          <h1>{p.name}</h1>
          <div className="page-meta">
            <StatusBadge tone={state.tone as any}>{state.label}</StatusBadge>
            <span>{isGraphics ? "Graphics" : "3D assets"}</span>
            <button type="button" onClick={() => setTab("design")}>
              Design v{p.designVersion} {ready ? "approved" : "awaiting approval"}
            </button>
            <button type="button" onClick={() => setTab("history")}>
              {costSummary(total.cost)} spent · {rs.length} requests
              {total.unpriced ? ` (${total.unpriced} unpriced)` : ""}
            </button>
          </div>
          {p.description && (
            <details className="overview-brief">
              <summary>Brief</summary>
              <div className="overview-description markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {p.description}
                </ReactMarkdown>
              </div>
            </details>
          )}
        </div>
        <div className="page-actions">
          {ready && !isGraphics && <ImportModel projectId={projectId} />}
          {ready ? (
            <Button onClick={() => setGenerate(true)}>
              <Plus size={17} /> Add {assetSingular} ideas
            </Button>
          ) : (
            activeTab !== "design" && (
              <Button onClick={() => setTab("design")}>Review design</Button>
            )
          )}
        </div>
      </section>
      {!ready && (
        <p className="note">
          Approve the design reference to start generating {assetPlural}.
          Ideas can be saved before approval.
        </p>
      )}
      {designUpdating && (
        <Alert className="mb-4">
          <AlertDescription>
            A design update is in progress. Review and approve the new revision when it finishes.
          </AlertDescription>
        </Alert>
      )}
      {data.workerHealthy === false && !!data.activeJobs?.length && (
        <WorkerNotice />
      )}
      {error && (
        <Alert variant="destructive" role="alert" className="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Tabs
        value={activeTab}
        onValueChange={(value) => setTab(value as ProjectTab)}
        className="workspace-tabs"
      >
        <TabsList variant="line" className="tabs" aria-label="Project views">
          {tabList.map(([id, title, count]) => (
            <TabsTrigger value={id} key={id}>
              {title}
              {!!count && (
                <Badge variant="secondary" className="count">
                  {count}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {activeTab === "materials" && (
          <MaterialPanel key={projectId} projectId={projectId} />
        )}
        {activeTab === "mockups" && ready && (
          <LightboxProvider>
            <DesignMockupStep
              key={projectId}
              projectId={projectId}
              version={p.designVersion}
              mockups={data.mockups || []}
              onRefresh={load}
            />
          </LightboxProvider>
        )}
        {activeTab === "style" && (
          <WorkshopPanel
            key={projectId}
            project={p}
            versions={[
              ...(data.versions || []),
              ...rs
                .filter((r: any) => r.role === "graphic" && r.status === "done")
                .map((r: any) => ({
                  ...r,
                  artifacts: { image: r.result?.key, renders: [r.result?.key] },
                })),
            ]}
            models={data.models || []}
            onSaved={load}
          />
        )}
        {activeTab === "design" && (
          <DesignReference
            key={projectId}
            project={p}
            revisions={data.revisions}
            updates={data.designUpdates || []}
            updating={designUpdating}
            onSaved={async (approved) => {
              await load();
              if (approved) setTab("models");
            }}
          />
        )}
        {activeTab === "history" && <History runs={rs} models={data.models} />}
        {activeTab === "ideas" && (
          <ModelIdeas
            key={projectId}
            projectId={projectId}
            ideas={ideas}
            designVersion={p.designVersion}
            isGraphics={isGraphics}
            ready={ready}
            onRefresh={load}
          />
        )}
        {activeTab === "models" && (
          <>
            {!hasCollection ? (
              <Empty className="empty">
                <h2>No {assetPlural} yet</h2>
                <p>
                  {ideas.length
                    ? `Start a saved idea from the Ideas tab to begin generating ${assetPlural}.`
                    : `Add a brief for the ${assetPlural} you want, or let AI propose a set from the design.`}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {!ideas.length && (
                    <Button onClick={() => setGenerate(true)}>
                      <Plus size={17} /> Add {assetSingular} ideas
                    </Button>
                  )}
                  {ready && (
                    <Button variant="outline" onClick={() => setTab("mockups")}>
                      Generate mockups first
                    </Button>
                  )}
                </div>
              </Empty>
            ) : (
              <>
                <div className="collection-toolbar">
                  <div
                    className="collection-filters"
                    role="group"
                    aria-label="Filter collection"
                  >
                    {(
                      [
                        ["all", "All"],
                        ["working", "In progress"],
                        ["attention", "Needs attention"],
                        ["finished", "Completed"],
                      ] as const
                    ).map(([id, label]) => (
                      <Button
                        key={id}
                        variant="ghost"
                        aria-pressed={filter === id}
                        onClick={() => setFilter(id)}
                      >
                        {label}
                        <span>{counts[id]}</span>
                      </Button>
                    ))}
                  </div>
                  <Input
                    aria-label="Search collection"
                    placeholder={`Search ${assetPlural}`}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <div className="model-grid">
                  {visiblePending.map((item) => (
                    <PendingModel
                      key={item.key}
                      batch={item.batch}
                      index={item.index}
                      busy={busy}
                      onResume={() => resumeBatch(item.batch.id)}
                      assetType={p.assetType}
                    />
                  ))}
                  {visibleModels.map((m: any) => {
                    const group = modelGroupByRepresentative.get(m.id);
                    const modelIds = new Set(
                      group?.assets.map((model) => model.id) || [m.id],
                    );
                    const root: any = group?.root || m;
                    const forkParent =
                      root.branchKind === "fork" &&
                      data.models.find((x: any) => x.id === root.parentModelId);
                    const lineage = [
                      group && group.assets.length > 1
                        ? `Iteration ${group.assets.length}`
                        : "",
                      forkParent
                        ? `Fork of ${forkParent.name.replaceAll("_", " ")}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <AssetCard
                        key={m.id}
                        projectId={projectId}
                        model={m}
                        lineage={lineage || undefined}
                        renderFailure={renderFailureByRepresentative.get(m.id)}
                        resumingBatch={busy}
                        onResumeBatch={resumeBatch}
                        activeJobs={(data.activeJobs || []).filter((job: any) => job.modelId === m.id && job.kind !== "model")}
                        isGraphics={isGraphics}
                        cost={rs
                          .filter((r: any) => modelIds.has(r.modelId))
                          .reduce(
                            (a: number, r: any) => a + (r.estimatedCost || 0),
                            0,
                          )}
                        sourceRunId={
                          rs.find(
                            (r: any) =>
                              r.role === "graphic" &&
                              r.modelId === m.id &&
                              r.status === "done",
                          )?.id
                        }
                        previewing={previewModelId === m.id}
                        onPreview={setPreviewModelId}
                        onRefresh={load}
                        onError={setError}
                      />
                    );
                  })}
                  {!visibleModels.length && !visiblePending.length && (
                    <Empty className="collection-no-results">
                      <h3>No matching {assetPlural}</h3>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setQuery("");
                          setFilter("all");
                        }}
                      >
                        Show all
                      </Button>
                    </Empty>
                  )}
                </div>
              </>
            )}
            {!isGraphics &&
              data.batches
                .filter(
                  (b: any) =>
                    b.preview &&
                    collectionModels.some((model) => model.batchId === b.id),
                )
                .map((b: any) => (
                  <details className="panel collection-preview" key={b.id}>
                    <summary>Collection renders</summary>
                    <div className="section-title">
                      <h3>Scale lineup and demo scene</h3>
                      <a href={fileUrl(b.preview.blend)} download>
                        Download demo scene
                      </a>
                    </div>
                    <div className="collection-renders">
                      <a
                        href={fileUrl(b.preview.lineup)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <AssetImage
                          src={fileUrl(b.preview.lineup)}
                          alt="Collection at consistent scale"
                        />
                        <span>Scale lineup</span>
                      </a>
                      <a
                        href={fileUrl(b.preview.scene)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <AssetImage
                          src={fileUrl(b.preview.scene)}
                          alt="Collection demo scene"
                        />
                        <span>Demo scene</span>
                      </a>
                    </div>
                  </details>
                ))}
          </>
        )}
      </Tabs>
      <GenerationDialog
        projectId={projectId}
        designVersion={p.designVersion}
        ready={ready}
        isGraphics={isGraphics}
        open={generate}
        onOpenChange={setGenerate}
        onRefresh={load}
        onSaved={async (started) => {
          await load();
          setTab(started ? "models" : "ideas");
        }}
      />
    </main>
  );
}
