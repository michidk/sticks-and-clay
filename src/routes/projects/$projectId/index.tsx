import { GenerationDialog } from "./-components/generation-dialog";
import { DesignMockupStep } from "./-components/design-mockups";
import {
  collectionAssetGroups,
  collectionSummary,
  projectState,
} from "@/lib/project-summary";
import { ProjectSetup } from "./-components/project-setup";
import { WorkshopPanel } from "./-components/workshop";
import { MaterialPanel } from "./-components/materials";
import { GraphicVariant } from "./-components/graphic-variant";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WorkspaceSkeleton,
  ViewerSkeleton,
  TextSkeleton,
} from "@/components/loading";
import { AssetImage } from "@/components/asset-image";
import { LightboxProvider } from "@/components/image-lightbox";
import { PictureUploader } from "@/components/picture-uploader";
import { useImageUpload } from "@/hooks/use-image-upload";
import { appendReferenceImages } from "@/lib/image-file";
import { TriangleCount } from "@/components/triangle-count";
import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { diffLines } from "diff";
import {
  ArrowLeft,
  Plus,
  Check,
  Download,
  Boxes,
  Activity,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import {
  request,
  json,
  money,
  costSummary,
  fileUrl,
} from "../../../lib/client";
import { Progress } from "../../../components/progress";
import { agentStateFromStatus } from "../../../components/agent-state";
import { PendingModel } from "./-components/pending-model";
import { pendingCollectionItems } from "./-lib/collection";
import { History } from "./-components/history";
const Viewer = lazy(() =>
  import("@/components/model-viewer").then((module) => ({
    default: module.ModelViewer,
  })),
);
export const Route = createFileRoute("/projects/$projectId/")({
  component: ProjectPage,
});
function ProjectPage() {
  const { projectId } = Route.useParams();
  const uploader = useImageUpload();
  const [data, setData] = useState<any>(),
    [tab, setTab] = useState(""),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [design, setDesign] = useState(""),
    [version, setVersion] = useState(-1),
    [editing, setEditing] = useState(false),
    [generate, setGenerate] = useState(false),
    [busy, setBusy] = useState(false),
    [previewModelId, setPreviewModelId] = useState<string | null>(null);
  async function load() {
    const d = await request("projects/" + projectId);
    setData(d);
    return d;
  }
  useEffect(() => {
    setData(undefined);
    setTab("");
    setVersion(-1);
    setDesign("");
    setEditing(false);
    uploader.reset();
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
  useEffect(() => {
    if (data && version === -1 && data.project.design) {
      setDesign(data.project.design);
      setVersion(data.project.designVersion);
      uploader.reset(data.project.references);
    }
  }, [data, version]);
  async function save(approve: boolean) {
    if (busy || uploader.isBusy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("design", design);
      form.set("version", String(version));
      form.set("approve", String(approve));
      appendReferenceImages(form, uploader.images);
      await request(`projects/${projectId}/design`, {
        method: "PUT",
        body: form,
      });
      const d = await load();
      setVersion(d.project.designVersion);
      setDesign(d.project.design);
      uploader.reset(d.project.references);
      setEditing(false);
      if (approve) setTab("mockups");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
  const total = rs.reduce(
    (a: any, r: any) => ({
      cost: a.cost + (r.estimatedCost || 0),
      unpriced: a.unpriced + (r.estimatedCost === null ? 1 : 0),
      tokens: a.tokens + r.inputTokens + r.outputTokens,
    }),
    { cost: 0, tokens: 0, unpriced: 0 },
  );
  const ready = p.status === "ready";
  const collection = collectionSummary(data.models, data.batches);
  const modelGroups = collectionAssetGroups(data.models);
  const collectionModels = modelGroups.map((group) => group.representative);
  const modelGroupByRepresentative = new Map(
    modelGroups.map((group) => [group.representative.id, group]),
  );
  const state = projectState(p.status, collection);
  const referencesChanged =
    uploader.images.length !== p.references.length ||
    uploader.images.some((image, index) => image.key !== p.references[index]);
  const designChanged = design !== p.design || referencesChanged;
  const saving = busy || uploader.isBusy;
  const designHeadings = [
    ...(design || p.design || "").matchAll(/^## (.+)$/gm),
  ].map((match, index) => ({ title: match[1], id: `design-section-${index}` }));
  let headingIndex = 0;
  const completed = collectionModels.filter(
    (m: any) => m.status === "done",
  ).length;
  const pending = pendingCollectionItems(data.batches, data.models);
  const queuedCount = pending.filter((item) => item.placeholder).length;
  const working =
    collectionModels.filter(
      (m: any) => !["done", "failed", "cancelled"].includes(m.status),
    ).length + pending.filter((item) => item.batch.status !== "failed").length;
  const needsReview =
    collectionModels.filter(
      (m: any) => m.verdict === "limit_reached" || m.status === "failed",
    ).length + pending.filter((item) => item.batch.status === "failed").length;
  const matches = (text: string) =>
    text.toLowerCase().includes(query.toLowerCase().trim());
  const visibleModels = collectionModels.filter(
    (m: any) =>
      matches(m.name + " " + m.prompt) &&
      (filter === "all" ||
        (filter === "working"
          ? !["done", "failed", "cancelled"].includes(m.status)
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
  const activeTab = !ready && ["", "models", "mockups"].includes(tab)
    ? "design"
    : tab || (!data.models.length && !data.batches.length ? "mockups" : "models");
  return (
    <main className="project-overview">
      <Link to="/" className="back">
        <ArrowLeft size={15} />
        All projects
      </Link>
      <section className="overview-hero">
        <div className="overview-intro">
          <div className="eyebrow">
            <Badge variant="secondary" className={"badge " + state.tone}>
              {state.label}
            </Badge>
            <span>
              {ready ? "Design approved" : "Design awaiting approval"}
            </span>
          </div>
          <h1>{p.name}</h1>
          <details className="overview-brief">
            <summary>Project brief</summary>
            <div className="overview-description markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {p.description ||
                  "One visual direction. A collection of possibilities."}
              </ReactMarkdown>
            </div>
          </details>
          <div className="overview-actions">
            <Button disabled={!ready} onClick={() => setGenerate(true)}>
              <Plus size={17} /> Generate {assetPlural}
            </Button>
            <Button variant="outline" onClick={() => setTab("design")}>
              <FileText size={16} />{" "}
              {p.designVersion
                ? `Design reference · v${p.designVersion}`
                : "Design reference"}
            </Button>
          </div>
          {!ready && (
            <p className="overview-hint">
              Approve the design reference to start generating {assetPlural}.
            </p>
          )}
        </div>
        <button
          className="overview-moodboard"
          onClick={() => setTab("design")}
          aria-label="Open project references"
        >
          {p.references.length ? (
            <div className="overview-reference-images">
              {p.references.slice(0, 3).map((f: string) => (
                <AssetImage
                  key={f}
                  src={fileUrl(f)}
                  alt="Project inspiration"
                />
              ))}
            </div>
          ) : (
            <div className="overview-reference-empty">
              <Boxes size={42} strokeWidth={1} />
            </div>
          )}
          <span>
            <span>THE VISUAL DIRECTION</span>
            <strong>
              {p.references.length} reference
              {p.references.length === 1 ? "" : "s"} <span>↗</span>
            </strong>
          </span>
        </button>
      </section>
      {ready && (
        <div className="overview-metrics">
          <div>
            <strong>{collectionModels.length + queuedCount}</strong>
            <span>in the collection</span>
          </div>
          <div>
            <strong>{working}</strong>
            <span>in progress</span>
          </div>
          <div>
            <strong>{needsReview}</strong>
            <span>need attention</span>
          </div>
          <button onClick={() => setTab("history")}>
            <strong>Est. {costSummary(total.cost)}</strong>
            <span>
              {total.unpriced
                ? `${total.unpriced} request${total.unpriced === 1 ? "" : "s"} not yet priced`
                : "View cost breakdown"}{" "}
              ↗
            </span>
          </button>
        </div>
      )}
      {error && (
        <Alert variant="destructive" role="alert" className="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {p.status === "review" && (
        <div className="review-banner">
          <span>
            <strong>Your design reference is ready.</strong> Review it before
            the artists get to work.
          </span>
          <Button variant="outline" onClick={() => setTab("design")}>
            Review design →
          </Button>
        </div>
      )}
      <nav aria-label="Collection creation steps" className="mb-5 grid grid-cols-3 gap-2">
        {[
          { id: "design", label: "1. Design reference" },
          { id: "mockups", label: "2. Mockups (optional)" },
          { id: "models", label: `3. ${isGraphics ? "Graphics" : "3D assets"}` },
        ].map((step) => <Button key={step.id} variant="outline"
          className="h-auto min-h-11 whitespace-normal text-center text-xs sm:text-sm"
          disabled={step.id !== "design" && !ready}
          aria-current={activeTab === step.id ? "step" : undefined}
          onClick={() => setTab(step.id)}>
          {step.label}
        </Button>)}
      </nav>
      <Tabs value={activeTab} onValueChange={setTab} className="workspace-tabs">
        <TabsList variant="line" className="tabs" aria-label="Project views">
          {[
            [
              "models",
              isGraphics ? "Graphics" : "3D assets",
              isGraphics ? ImageIcon : Boxes,
            ],
            ["design", "Design reference", FileText],
            ...(ready ? [["mockups", "Mockups", ImageIcon]] : []),
            ["style", "Collection style", Boxes],
            ...(!isGraphics && ready
              ? [["materials", "PBR materials", Boxes]]
              : []),
            ["history", "Activity & cost", Activity],
          ]
            .filter(([id]) => ready || id !== "models")
            .map(([id, title, Icon]: any) => (
              <TabsTrigger value={id} key={id}>
                <Icon size={17} />
                {title}
                {id === "history" && (
                  <Badge variant="secondary" className="count">
                    {rs.length}
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
            <DesignMockupStep key={projectId} projectId={projectId}
              version={p.designVersion} mockups={data.mockups || []}
              isGraphics={isGraphics} onRefresh={load}
              onGenerate={() => { setTab("models"); setGenerate(true); }} />
          </LightboxProvider>
        )}
        {activeTab === "style" && (
          <WorkshopPanel
            key={projectId}
            project={p}
            versions={[
              ...(data.versions || []),
              ...(data.runs || [])
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
          <div className="design-layout">
            <Card className="panel">
              <div className="section-title">
                <div>
                  <h2>
                    Design reference · v
                    {version < 0 ? p.designVersion : version}
                  </h2>
                  <p className="muted">
                    {designChanged
                      ? "Unsaved draft · not used for generation"
                      : ready
                        ? "Approved for new generations"
                        : "Awaiting approval"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => {
                    setEditing(!editing);
                  }}
                >
                  {editing ? "Preview" : "Edit design"}
                </Button>
              </div>
              <p className="note">
                Saving a draft requires approval before new generation. Approval
                applies to future batches; existing batches keep their saved
                design. Reference changes are saved with the design and do not
                rewrite the document automatically.
              </p>
              {!editing && !!designHeadings.length && (
                <nav className="design-contents" aria-label="Design sections">
                  {designHeadings.map((heading) => (
                    <a key={heading.id} href={`#${heading.id}`}>
                      {heading.title}
                    </a>
                  ))}
                </nav>
              )}
              {editing ? (
                <Textarea
                  className="design-editor"
                  aria-label="Design reference"
                  disabled={saving}
                  value={design}
                  onChange={(e) => setDesign(e.target.value)}
                />
              ) : (
                <div className="markdown">
                  {design || p.design ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h2: ({ children }) => (
                          <h2 id={`design-section-${headingIndex++}`}>
                            {children}
                          </h2>
                        ),
                      }}
                    >
                      {design || p.design}
                    </ReactMarkdown>
                  ) : (
                    <TextSkeleton
                      label="Preparing design reference"
                      lines={8}
                    />
                  )}
                </div>
              )}
              {p.design && (editing || designChanged || !ready) && (
                <div className="actions design-actions">
                  <span>
                    {designChanged
                      ? "Unsaved changes"
                      : "Review this direction before approving"}
                  </span>
                  {(editing || designChanged) && (
                    <Button
                      variant="ghost"
                      disabled={saving}
                      onClick={() => {
                        setDesign(p.design);
                        setVersion(p.designVersion);
                        uploader.reset(p.references);
                        setEditing(false);
                      }}
                    >
                      Discard edits
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={saving || !designChanged || design.length < 100}
                    onClick={() => save(false)}
                  >
                    Save as draft
                  </Button>
                  <Button
                    variant="default"
                    className=""
                    disabled={saving || design.length < 100}
                    onClick={() => save(true)}
                  >
                    <Check size={17} />
                    {busy
                      ? "Saving…"
                      : designChanged
                        ? "Save & approve design"
                        : "Approve design"}
                  </Button>
                </div>
              )}
            </Card>
            <aside>
              <Card className="panel">
                <PictureUploader
                  images={uploader.images}
                  onFilesAdded={uploader.addFiles}
                  onImportFromUrl={uploader.importFromUrl}
                  onRemove={uploader.remove}
                  disabled={busy}
                  isBusy={uploader.isBusy}
                />
                <p className="muted">
                  Add or remove references before saving or approving the design.
                </p>
              </Card>
              <Card className="panel">
                <h3>Design history</h3>
                <p className="muted">Every generation uses a saved snapshot.</p>
                {data.revisions.map((r: any) => (
                  <Accordion type="single" collapsible key={r.id}>
                    <AccordionItem value="content">
                      <AccordionTrigger>
                        Version {r.version} · {r.author}
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {r.content}
                          </ReactMarkdown>
                        </div>
                        <Accordion type="single" collapsible>
                          <AccordionItem value="content">
                            <AccordionTrigger>
                              Compare with current version
                            </AccordionTrigger>
                            <AccordionContent>
                              <pre className="revision-diff">
                                {diffLines(r.content, p.design).map(
                                  (part, i) => (
                                    <span
                                      key={i}
                                      className={
                                        part.added
                                          ? "diff-added"
                                          : part.removed
                                            ? "diff-removed"
                                            : ""
                                      }
                                    >
                                      {part.value}
                                    </span>
                                  ),
                                )}
                              </pre>
                              <small>
                                Green: added in current version. Red: removed
                                from this version.
                              </small>
                            </AccordionContent>
                          </AccordionItem>
                        </Accordion>
                        <Button
                          variant="outline"
                          disabled={
                            saving || !["ready", "review"].includes(p.status)
                          }
                          onClick={() => {
                            setDesign(r.content);
                            setVersion(p.designVersion);
                            setEditing(true);
                          }}
                        >
                          Restore as draft
                        </Button>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ))}
              </Card>
            </aside>
          </div>
        )}
        {activeTab === "history" && <History runs={rs} models={data.models} />}
        {activeTab === "models" && (
          <>
            <div className="collection-heading">
              <div>
                <h2>
                  Collection{" "}
                  <span>{collectionModels.length + queuedCount}</span>
                </h2>
              </div>
              <Input
                aria-label="Search collection"
                placeholder={`Find a ${assetSingular}…`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div
              className="collection-filters"
              role="group"
              aria-label="Filter collection"
            >
              {[
                [
                  "all",
                  `All ${assetPlural}`,
                  collectionModels.length + queuedCount,
                ],
                ["working", "In progress", working],
                ["attention", "Needs attention", needsReview],
                ["finished", "Completed", completed],
              ].map(([id, label, count]) => (
                <Button
                  key={id}
                  variant="ghost"
                  aria-pressed={filter === id}
                  onClick={() => setFilter(String(id))}
                >
                  {label}
                  <span>{count}</span>
                </Button>
              ))}
            </div>
            {!data.models.length && !data.batches.length ? (
              <Empty className="empty">
                <div className="circle">
                  {isGraphics ? <ImageIcon size={32} /> : <Boxes size={32} />}
                </div>
                <h2>Your collection is a blank canvas.</h2>
                <p>
                  {ready
                    ? `Describe a ${assetSingular}, or ask your agents to invent a cohesive set.`
                    : "Start by reviewing and approving your project design."}
                </p>
                <Button
                  variant="default"
                  className=""
                  onClick={() => (ready ? setGenerate(true) : setTab("design"))}
                >
                  {ready
                    ? `Create your first ${assetPlural}`
                    : "Open design reference"}
                  <ArrowLeft
                    style={{ transform: "rotate(180deg)" }}
                    size={16}
                  />
                </Button>
              </Empty>
            ) : (
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
                  const cost = rs
                    .filter((r: any) => modelIds.has(r.modelId))
                    .reduce(
                      (a: number, r: any) => a + (r.estimatedCost || 0),
                      0,
                    );
                  return (
                    <Card key={m.id} className="model-card">
                      <div
                        className={`model-cover${isGraphics ? " graphic-cover" : ""}`}
                      >
                        {isGraphics && m.artifacts?.image ? (
                          <a
                            className="model-cover-image"
                            href={fileUrl(m.artifacts.image)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <AssetImage
                              src={fileUrl(m.artifacts.image)}
                              alt={m.name}
                            />
                            <span className="orbit-label">
                              Open full image ↗
                            </span>
                          </a>
                        ) : previewModelId === m.id && m.artifacts ? (
                          <Suspense fallback={<ViewerSkeleton />}>
                            <Viewer
                              src={fileUrl(m.artifacts.glb)}
                              alt={`${m.name} quick preview`}
                              className="model-card-viewer"
                              height="100%"
                              showUi={false}
                              autoRotate
                            />
                          </Suspense>
                        ) : (
                          <Link
                            className="model-cover-image"
                            to="/projects/$projectId/models/$modelId"
                            params={{ projectId, modelId: m.id }}
                            search={{
                              view: m.artifacts ? "3d" : "target",
                              section: "review",
                            }}
                          >
                            {m.artifacts?.renders?.[0] || m.visualTarget ? (
                              <AssetImage
                                src={fileUrl(
                                  m.artifacts?.renders?.[0] || m.visualTarget,
                                )}
                                alt={m.name}
                              />
                            ) : (
                              <div className="abstract">
                                <Boxes size={56} strokeWidth={1} />
                                {!["failed", "done", "cancelled"].includes(
                                  m.status,
                                ) && <span>Taking shape</span>}
                              </div>
                            )}
                            {(m.artifacts || m.visualTarget) && (
                              <span className="orbit-label">
                                {m.artifacts
                                  ? "Explore in 3D ↗"
                                  : "Visual target · concept image"}
                              </span>
                            )}
                          </Link>
                        )}
                        <Badge
                          variant="secondary"
                          className={
                            "badge " +
                            (m.verdict === "limit_reached"
                              ? "warning"
                              : m.status)
                          }
                        >
                          {m.verdict === "limit_reached"
                            ? "Completed with issues"
                            : m.verdict === "approved"
                              ? "Approved"
                              : m.status}
                        </Badge>
                      </div>
                      <div className="project-body">
                        <h3>
                          {isGraphics ? (
                            m.name.replaceAll("_", " ")
                          ) : (
                            <Link
                              to="/projects/$projectId/models/$modelId"
                              params={{ projectId, modelId: m.id }}
                              search={{ view: "3d", section: "review" }}
                            >
                              {m.name.replaceAll("_", " ")}
                            </Link>
                          )}
                        </h3>
                        {m.branchKind && (
                          <span className="model-branch-label">
                            {m.branchKind === "fork"
                              ? "Forked variant"
                              : "Prompt iteration"}
                          </span>
                        )}
                        <p>{m.changePrompt || m.prompt}</p>
                        {!isGraphics && m.artifacts && (
                          <Button
                            variant="outline"
                            onClick={() =>
                              setPreviewModelId(
                                previewModelId === m.id ? null : m.id,
                              )
                            }
                            aria-pressed={previewModelId === m.id}
                          >
                            {previewModelId === m.id
                              ? "Show render"
                              : "Quick 3D preview"}
                          </Button>
                        )}
                        {!["done", "failed", "cancelled"].includes(
                          m.status,
                        ) && (
                          <Progress
                            value={m.progress}
                            label={m.phase}
                            agentState={agentStateFromStatus(m.status)}
                          />
                        )}
                        {m.artifacts?.stage === "geometry" && (
                          <p className="note">
                            Geometry preview · materials pending
                          </p>
                        )}
                        <div className="card-meta">
                          <span>
                            {m.artifacts && !isGraphics ? (
                              <TriangleCount artifacts={m.artifacts} suffix />
                            ) : isGraphics && m.artifacts?.image ? (
                              "PNG"
                            ) : (
                              m.phase
                            )}
                          </span>
                          <span>{money(cost)}</span>
                        </div>
                        {isGraphics ? (
                          <Button
                            variant="outline"
                            onClick={() => setTab("history")}
                          >
                            View generation activity ↗
                          </Button>
                        ) : (
                          <Button variant="outline" asChild>
                            <Link
                              to="/projects/$projectId/models/$modelId"
                              params={{ projectId, modelId: m.id }}
                              search={{ view: "3d", section: "versions" }}
                            >
                              View model & history ↗
                            </Link>
                          </Button>
                        )}
                        {m.error && (
                          <Alert variant="destructive" className="error">
                            <AlertDescription>{m.error}</AlertDescription>
                          </Alert>
                        )}
                        {m.status === "failed" && (
                          <Button
                            variant="outline"
                            onClick={async () => {
                              try {
                                await request(
                                  "models/" + m.id + "/retry",
                                  json({}),
                                );
                                await load();
                              } catch (e) {
                                setError(String(e));
                              }
                            }}
                          >
                            Resume {assetSingular}
                          </Button>
                        )}
                        {isGraphics && m.artifacts?.image ? (
                          <div className="downloads">
                            <a href={fileUrl(m.artifacts.image)} download>
                              <Download size={14} />
                              Download PNG
                            </a>
                            <GraphicVariant
                              model={m}
                              sourceRunId={
                                data.runs.find(
                                  (r: any) =>
                                    r.role === "graphic" &&
                                    r.modelId === m.id &&
                                    r.status === "done",
                                )?.id
                              }
                              onSaved={load}
                            />
                          </div>
                        ) : m.artifacts ? (
                          <div className="downloads">
                            <a href={fileUrl(m.artifacts.glb)} download>
                              <Download size={14} />
                              GLB
                            </a>
                            <a href={fileUrl(m.artifacts.blend)} download>
                              Blender source
                            </a>
                          </div>
                        ) : null}
                      </div>
                    </Card>
                  );
                })}
                {!visibleModels.length && !visiblePending.length && (
                  <Empty className="collection-no-results">
                    <h3>No matching {assetPlural}</h3>
                    <p>Try another search or filter.</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQuery("");
                        setFilter("all");
                      }}
                    >
                      Show all {assetPlural}
                    </Button>
                  </Empty>
                )}
              </div>
            )}
            {!isGraphics &&
              data.batches
                .filter((b: any) => b.preview)
                .map((b: any) => (
                  <details className="panel collection-preview" key={b.id}>
                    <summary>
                      Collection studio · scale lineup & demo scene
                    </summary>
                    <div className="section-title">
                      <h3>Presentation renders</h3>
                      <a href={fileUrl(b.preview.blend)} download>
                        Download demo scene ↗
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
        isGraphics={isGraphics}
        open={generate}
        error={error}
        onOpenChange={setGenerate}
        onError={setError}
        onRefresh={load}
        onGenerated={async () => { setTab("models"); await load(); }}
      />
    </main>
  );
}
