import { finishedAssetReferences } from "./-lib/finished-asset-references";
import { ProjectResolution } from "./-components/project-resolution";
import { GenerationDialog } from "./-components/generation-dialog";
import { AssetDrafts } from "./-components/asset-drafts";
import { ExportPanel } from "./-components/export";
import { ProjectActionsMenu } from "@/components/project-actions-menu";
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
import { MaterialPanel } from "./-components/materials";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { assetStage, boardStages, boardStageTitles, latestSourceRun, type BoardStage } from "@/lib/board";
import { StageStrip, stageHints, stageMeanings } from "./-components/stage-strip";
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
import { Activity as ActivityIcon, Plus } from "lucide-react";
import { request, json, costSummary, fileUrl, previewUrl } from "../../../lib/client";
import { assetTypeLabels, type AssetType } from "@/lib/asset-types";
import { PendingModel } from "./-components/pending-model";
import { failedBatchFor, pendingCollectionItems } from "./-lib/collection";
import { History } from "./-components/history";
import { queueKindLabels } from "@/lib/queue-view";

// The workflow from left to right, plus the activity log.
const tabs = ["design", "mockups", ...boardStages, "export", "history"] as const;
export type ProjectTab = (typeof tabs)[number];
const designViews = ["reference", "materials"] as const;
type DesignView = (typeof designViews)[number];
type Search = { tab?: ProjectTab; view?: DesignView };
// Earlier tab reworks: Style became Design; Materials became a design view; the asset tabs became stages.
const legacyTabs: Record<string, Search> = {
  style: { tab: "design" },
  materials: { tab: "design", view: "materials" },
  ideas: { tab: "idea" },
  assets: {},
  board: {},
  models: {},
  collection: { tab: "export" },
};
export const Route = createFileRoute("/projects/$projectId/")({
  validateSearch: z
    .object({
      tab: z.string().optional().catch(undefined),
      view: z.enum([...designViews, "mockups"]).optional().catch(undefined),
      stage: z.enum(boardStages).optional().catch(undefined),
    })
    .transform(({ tab, stage, view }): Search => {
      // Mockups was briefly a design view before it became a step.
      const rest: Search = view === "mockups" ? { tab: "mockups" } : { view };
      if (rest.tab) return rest;
      const search: Search = tab && legacyTabs[tab]
        ? { ...rest, ...legacyTabs[tab] }
        : { ...rest, tab: (tabs as readonly string[]).includes(tab ?? "") ? (tab as ProjectTab) : undefined };
      return search.tab ? search : { ...search, tab: stage };
    }),
  component: ProjectPage,
});
function ProjectPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<any>(),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [generate, setGenerate] = useState(false),
    [busy, setBusy] = useState(false),
    [previewModelId, setPreviewModelId] = useState<string | null>(null);
  const setTab = (tab: ProjectTab, rest: Omit<Search, "tab"> = {}) =>
    navigate({ search: { tab, ...rest }, resetScroll: false });
  async function load() {
    const d = await request(`projects/${projectId}?summary=true&versions=false`);
    setData(d);
    return d;
  }
  useEffect(() => {
    setData(undefined);
    setPreviewModelId(null);
    setQuery("");
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const refresh = () =>
      request(`projects/${projectId}?summary=true&versions=false`, { signal: controller.signal })
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
  const isGraphics = p.assetType !== "model";
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
  // Assets returned to Ideas (an aborted first attempt) keep their versions but leave the collection.
  const inIdeas = new Set(data.assets?.filter((asset: any) => asset.inIdea).map((asset: any) => asset.id));
  const collectionVersions = data.assetVersions.filter((version: any) => !inIdeas.has(version.assetId));
  const collection = collectionSummary(collectionVersions, data.batches);
  const modelGroups = collectionAssetGroups(collectionVersions);
  const collectionModels = modelGroups.map((group) => group.representative);
  const modelGroupByRepresentative = new Map(
    modelGroups.map((group) => [group.representative.id, group]),
  );
  const activeWork = data.activeJobs?.find((job: any) => job.kind !== "model");
  const designUpdating = data.activeJobs?.some((job: any) => ["design", "design-from-model", "design-update"].includes(job.kind)) || false;
  const state = activeWork
    ? { label: `${queueKindLabels[activeWork.kind] || activeWork.kind} · ${activeWork.status}`, tone: activeWork.status === "queued" ? "queued" : "running" }
    : projectState(p.status, collection);
  const pending = pendingCollectionItems(data.batches, collectionVersions);
  // Collection renders that failed after the models existed belong on those models' cards.
  const renderFailureByRepresentative = new Map(
    modelGroups.map((group) => [
      group.representative.id,
      failedBatchFor(data.batches, group.assets),
    ]),
  );
  const needsAttention = (m: any) =>
    m.verdict === "limit_reached" ||
    ["failed", "awaiting_approval"].includes(m.status) ||
    Boolean(renderFailureByRepresentative.get(m.id));
  const ideas = data.ideas || [];
  const stageCounts: Record<BoardStage, number> = {
    idea: ideas.filter((idea: any) => !idea.readyAt).length,
    ready: ideas.filter((idea: any) => idea.readyAt).length,
    progress: collectionModels.filter((m: any) => assetStage(m) === "progress").length + pending.length,
    review: collectionModels.filter((m: any) => assetStage(m) === "review").length,
    done: collectionModels.filter((m: any) => assetStage(m) === "done").length,
  };
  // An approved project opens on the stage that needs the owner next: running work, then reviews, then unstarted ideas.
  const firstStage = (["progress", "review", "idea", "ready", "done"] as const).find((id) => stageCounts[id]) ?? "idea";
  const activeTab: ProjectTab = search.tab ?? (ready ? firstStage : "design");
  const stage = activeTab as BoardStage;
  const matches = (text: string) =>
    text.toLowerCase().includes(query.toLowerCase().trim());
  const visibleModels = collectionModels.filter(
    (m: any) => assetStage(m) === stage && matches(m.name + " " + m.prompt),
  );
  const visiblePending = stage === "progress" ? pending.filter((item) => matches(item.batch.prompt)) : [];
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
  const hasCollection = data.assetVersions.length || data.batches.length;
  // Mockups and materials need an approved version.
  const designView: DesignView = ready ? search.view ?? "reference" : "reference";
  const designViewList: [DesignView, string][] = [
    ["reference", `Reference · v${p.designVersion}`],
    ...(ready && !isGraphics ? [["materials", "Materials"] as [DesignView, string]] : []),
  ];
  const mockups = data.mockups || [];
  const steps = [
    { id: "design", title: "Design", hint: ready ? `v${p.designVersion} approved` : "Awaiting approval" },
    { id: "mockups", title: "Mockups", count: mockups.length, hint: "Concept images" },
    ...boardStages.map((id) => {
      const attention = collectionModels.filter((model: any) => assetStage(model) === id && needsAttention(model)).length +
        (id === "progress" ? pending.filter((item) => item.batch.status === "failed").length : 0);
      return {
        id,
        title: boardStageTitles[id],
        count: stageCounts[id],
        hint: attention ? (attention === 1 ? "1 needs attention" : `${attention} need attention`) : stageHints[id],
        warn: attention > 0,
      };
    }),
    { id: "export", title: "Export", count: stageCounts.done, hint: "Download a zip" },
  ] satisfies { id: ProjectTab; title: string; hint: string; count?: number; warn?: boolean }[];
  const stageEmpty: Record<BoardStage, [string, string]> = {
    idea: [`No ${assetPlural} yet`, `Add a brief for the ${assetPlural} you want, or let AI propose a set from the design.`],
    ready: ["Nothing marked ready", "Mark an idea ready when its brief is final. Starting works from either stage."],
    progress: ["Nothing in progress", "Start a ready idea to queue generation."],
    review: ["Nothing to review", `Finished ${assetPlural} wait here for your decision.`],
    done: ["Nothing accepted yet", `Accept reviewed ${assetPlural} to mark them done.`],
  };
  return (
    <main className="project-overview">
      <Breadcrumbs
        items={[{ label: "Projects", link: { to: "/projects" } }, { label: p.name }]}
      />
      <section className="page-header">
        <div>
          <h1>{p.name}</h1>
          <div className="page-meta">
            <StatusBadge tone={state.tone as any}>{state.label}</StatusBadge>
            <span>{assetTypeLabels[p.assetType as AssetType]}</span>
            <button type="button" aria-label={`Activity: ${rs.length} AI requests, estimated cost ${costSummary(total.cost)}`} title="View activity" aria-pressed={activeTab === "history"} onClick={() => setTab("history")}>
              <ActivityIcon size={13} aria-hidden="true" />
              {rs.length} {rs.length === 1 ? "request" : "requests"} · {costSummary(total.cost)}
              {total.unpriced ? ` (${total.unpriced} unpriced)` : ""}
            </button>
          </div>
        </div>
        <div className="page-actions">
          <ProjectActionsMenu
            className="project-header-menu"
            project={p}
            canDelete={!hasCollection && !designUpdating}
            onChanged={load}
            onDeleted={() => navigate({ to: "/projects" })}
          />
          {!ready && activeTab !== "design" && (
            <Button onClick={() => setTab("design")}>Review design</Button>
          )}
        </div>
      </section>
      {p.archivedAt && (
        <Alert className="mb-4">
          <AlertDescription>
            This project is archived. It stays readable, but generation is paused until you unarchive it from the actions menu.
          </AlertDescription>
        </Alert>
      )}
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
      <section className="workspace-tabs">
        <StageStrip steps={steps} current={activeTab} onSelect={(id) => setTab(id)} />
        {activeTab === "design" && designViewList.length > 1 && (
          <Tabs value={designView} onValueChange={(value) => setTab("design", { view: value as DesignView })}>
            <TabsList variant="line" className="tabs compact" aria-label="Design views">
              {designViewList.map(([id, title]) => (
                <TabsTrigger value={id} key={id}>{title}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        {activeTab === "design" && designView === "reference" && p.description && (
          <details className="overview-brief">
            <summary>Original brief</summary>
            <div className="overview-description markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.description}</ReactMarkdown>
            </div>
          </details>
        )}
        {activeTab === "design" && designView === "materials" && (
          <MaterialPanel key={projectId} projectId={projectId} />
        )}
        {activeTab === "mockups" && !ready && (
          <Empty className="empty">
            <h2>Mockups need an approved design</h2>
            <p>Approve the design reference first. Mockups are paid concept images generated from it.</p>
            <Button onClick={() => setTab("design")}>Review design</Button>
          </Empty>
        )}
        {activeTab === "mockups" && ready && (
          <LightboxProvider>
            <DesignMockupStep
              assets={data.assets}
              key={projectId}
              projectId={projectId}
              version={p.designVersion}
              design={p.design}
              assetType={p.assetType}
              mockups={mockups}
              items={data.mockupItems || []}
              references={p.references}
              onRefresh={load}
            />
          </LightboxProvider>
        )}
        {activeTab === "design" && designView === "reference" && (
          <>
            {(p.assetType === "pixel" || p.assetType === "graphic") && (
              <ProjectResolution
                projectId={projectId} type={p.assetType} workshop={p.workshop}
                disabled={Boolean(p.archivedAt)} onSaved={load}
              />
            )}
            <DesignReference
              key={projectId}
              project={p}
              assetImages={finishedAssetReferences(data.assetVersions, data.runs)}
              revisions={data.revisions}
              updates={data.designUpdates || []}
              updating={designUpdating}
              onOpenMockups={() => setTab("mockups")}
              onSaved={async (approved) => {
                await load();
                if (approved) setTab(firstStage);
              }}
            />
          </>
        )}
        {activeTab === "export" && (
          <>
            <div className="stage-head">
              <div>
                <h2>Export</h2>
                <p className="muted">Zip every saved file of the accepted {assetPlural}. Collection renders follow below.</p>
              </div>
            </div>
            <ExportPanel projectId={projectId} projectName={p.name} models={data.assetVersions} />
            {isGraphics &&
              data.batches
                .filter(
                  (b: any) =>
                    b.preview?.sheet &&
                    collectionModels.some((model) => model.batchId === b.id),
                )
                .map((b: any) => (
                  <section className="panel collection-preview" key={b.id}>
                    <div className="section-title">
                      <h3>Every finished {assetSingular} in this batch</h3>
                      <a href={fileUrl(b.preview.sheet)} download>
                        Download sheet
                      </a>
                    </div>
                    <div className="collection-renders">
                      <a
                        href={previewUrl(b.preview.sheet)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <AssetImage
                          src={fileUrl(b.preview.sheet)}
                          alt={`Grid of every ${assetSingular} in the batch`}
                        />
                        <span>Collection sheet</span>
                      </a>
                    </div>
                  </section>
                ))}
            {!isGraphics &&
              data.batches
                .filter(
                  (b: any) =>
                    b.preview &&
                    collectionModels.some((model) => model.batchId === b.id),
                )
                .map((b: any) => (
                  <section className="panel collection-preview" key={b.id}>
                    <div className="section-title">
                      <h3>Scale lineup and demo scene</h3>
                      <a href={fileUrl(b.preview.blend)} download>
                        Download demo scene
                      </a>
                    </div>
                    <div className="collection-renders">
                      <a
                        href={previewUrl(b.preview.lineup)}
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
                        href={previewUrl(b.preview.scene)}
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
                  </section>
                ))}
          </>
        )}
        {activeTab === "history" && <History runs={rs} models={data.assetVersions} />}
        {(boardStages as readonly string[]).includes(activeTab) && (
          <>
            <div className="stage-head">
              <div>
                <h2>{boardStageTitles[stage]}</h2>
                <p className="muted">{stageMeanings[stage]}</p>
              </div>
              <div className="stage-actions">
                {stageCounts[stage] > 0 && !["idea", "ready"].includes(stage) && (
                  <Input
                    aria-label="Search collection"
                    placeholder={`Search ${assetPlural}`}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                )}
                {stage === "review" && ready && !isGraphics && !p.archivedAt && <ImportModel projectId={projectId} />}
                {stage === "idea" && (
                  <Button disabled={Boolean(p.archivedAt)} onClick={() => setGenerate(true)}>
                    <Plus size={17} /> Add asset
                  </Button>
                )}
              </div>
            </div>
            {!stageCounts[stage] ? (
              <Empty className="empty">
                <h2>{stageEmpty[stage][0]}</h2>
                <p>{stageEmpty[stage][1]}</p>
                {stage === "idea" && ready && (
                  <Button variant="outline" onClick={() => setTab("mockups")}>Generate mockups first</Button>
                )}
              </Empty>
            ) : ["idea", "ready"].includes(stage) ? (
              <AssetDrafts
                assetType={p.assetType}
                key={projectId + stage}
                projectId={projectId}
                ideas={ideas.filter((idea: any) => (stage === "ready") === Boolean(idea.readyAt))}
                designVersion={p.designVersion}
                isGraphics={isGraphics}
                ready={ready}
                onRefresh={load}
              />
            ) : (
              <>
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
                      data.assetVersions.find((x: any) => x.id === root.parentModelId);
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
                        asset={data.assets?.find((asset: { id: string }) => asset.id === m.assetId)}
                        key={m.id}
                        projectId={projectId}
                        model={m}
                        lineage={lineage || undefined}
                        batch={data.batches.find((b: any) => b.id === m.batchId)}
                        currentDesignVersion={p.designVersion}
                        designReady={ready}
                        archived={!!p.archivedAt}
                        deleteTarget={{ id: root.id, versions: group?.assets.length ?? 1 }}
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
                        sourceRunId={latestSourceRun(rs, m.id)}
                        previewing={previewModelId === m.id}
                        onPreview={setPreviewModelId}
                        onRefresh={load}
                        onError={setError}
                        onReturnedToIdea={() => setTab("idea")}
                      />
                    );
                  })}
                  {!visibleModels.length && !visiblePending.length && (
                    <Empty className="collection-no-results">
                      <h3>No matching {assetPlural}</h3>
                      <Button variant="outline" onClick={() => setQuery("")}>
                        Show all
                      </Button>
                    </Empty>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </section>
      <GenerationDialog
        assetType={p.assetType}
        projectId={projectId}
        designVersion={p.designVersion}
        ready={ready}
        isGraphics={isGraphics}
        open={generate}
        onOpenChange={setGenerate}
        onRefresh={load}
        onSaved={async () => {
          await load();
          setTab("idea");
        }}
      />
    </main>
  );
}
