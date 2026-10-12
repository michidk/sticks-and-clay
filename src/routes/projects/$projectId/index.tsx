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
import { pendingCollectionItems } from "./-lib/collection";
import { History } from "./-components/history";

const tabs = [
  "models",
  "ideas",
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
    const d = await request("projects/" + projectId);
    setData(d);
    return d;
  }
  useEffect(() => {
    setData(undefined);
    setPreviewModelId(null);
    setFilter("all");
    setQuery("");
    let active = true;
    const refresh = () =>
      request("projects/" + projectId)
        .then((d) => {
          if (active) setData(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void refresh();
    const t = setInterval(refresh, 2500);
    return () => {
      active = false;
      clearInterval(t);
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
  const state = projectState(p.status, collection);
  const pending = pendingCollectionItems(data.batches, data.models);
  const ideas = data.ideas || [];
  const counts = {
    all: collectionModels.length + pending.filter((i) => i.placeholder).length,
    working:
      collectionModels.filter((m: any) => !finished.includes(m.status)).length +
      pending.filter((item) => item.batch.status !== "failed").length,
    attention:
      collectionModels.filter(
        (m: any) => m.verdict === "limit_reached" || m.status === "failed",
      ).length + pending.filter((item) => item.batch.status === "failed").length,
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
            ? m.verdict === "limit_reached" || m.status === "failed"
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
  const activeTab: ProjectTab =
    !ready && (!search.tab || search.tab === "models" || search.tab === "mockups")
      ? "design"
      : search.tab || "models";
  const hasCollection = data.models.length || data.batches.length;
  const tabList: [ProjectTab, string, number?][] = [
    ...(ready
      ? [[ "models", isGraphics ? "Graphics" : "Models", counts.all] as [ProjectTab, string, number]]
      : []),
    ["ideas", "Ideas", ideas.length],
    ["design", "Design"],
    ...(ready ? [["mockups", "Mockups"] as [ProjectTab, string]] : []),
    ["style", "Style"],
    ...(!isGraphics && ready
      ? [["materials", "Materials"] as [ProjectTab, string]]
      : []),
  ];
  return (
    <main className="project-overview">
      <Breadcrumbs
        items={[
          { label: "Projects", link: { to: "/" } },
          { label: p.name, link: { to: ".", search: {} } },
          ...(activeTab === "history" ? [{ label: "Activity" }] : []),
        ]}
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
        {activeTab === "ideas" && (
          <ModelIdeas
            key={projectId}
            projectId={projectId}
            ideas={ideas}
            isGraphics={isGraphics}
            ready={ready}
            onAdd={() => setGenerate(true)}
            onRefresh={load}
            onGenerated={() => setTab("models")}
          />
        )}
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
            onSaved={async (approved) => {
              await load();
              if (approved) setTab("models");
            }}
          />
        )}
        {activeTab === "history" && <History runs={rs} models={data.models} />}
        {activeTab === "models" && (
          <>
            {!hasCollection ? (
              <Empty className="empty">
                <h2>No {assetPlural} yet</h2>
                <p>
                  {ideas.length
                    ? `${ideas.length} saved idea${ideas.length === 1 ? "" : "s"} waiting to start.`
                    : `Add a brief for the ${assetPlural} you want, or let AI propose a set from the design.`}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {ideas.length ? (
                    <Button onClick={() => setTab("ideas")}>Open ideas</Button>
                  ) : (
                    <Button onClick={() => setGenerate(true)}>
                      <Plus size={17} /> Add {assetSingular} ideas
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setTab("mockups")}>
                    Generate mockups first
                  </Button>
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
                      placeholder={item.placeholder}
                      busy={busy}
                      onResume={() => resumeBatch(item.batch.id)}
                      assetType={p.assetType}
                    />
                  ))}
                  {visibleModels.map((m: any) => {
                    const modelIds = new Set(
                      modelGroupByRepresentative
                        .get(m.id)
                        ?.assets.map((model) => model.id) || [m.id],
                    );
                    return (
                      <AssetCard
                        key={m.id}
                        projectId={projectId}
                        model={m}
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
                .filter((b: any) => b.preview)
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
        onSaved={async () => {
          await load();
          setTab("ideas");
        }}
      />
    </main>
  );
}
