import {
  collectionAssetGroups,
  collectionSummary,
  projectState,
} from "@/lib/project-summary";
import { ProjectSetup } from "./-components/project-setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownTextarea } from "@/components/markdown-textarea";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Empty } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WorkspaceSkeleton,
  ViewerSkeleton,
  TextSkeleton,
} from "@/components/loading";
import { AssetImage } from "@/components/asset-image";
import { TriangleCount } from "@/components/triangle-count";
import type { RuntimeSettings } from "@/lib/contracts";
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
  Play,
  LoaderCircle,
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
  const [data, setData] = useState<any>(),
    [tab, setTab] = useState("models"),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [design, setDesign] = useState(""),
    [version, setVersion] = useState(-1),
    [editing, setEditing] = useState(false),
    [generate, setGenerate] = useState(false),
    [busy, setBusy] = useState(false),
    [previewModelId, setPreviewModelId] = useState<string | null>(null),
    [modelBrief, setModelBrief] = useState(""),
    [modelCount, setModelCount] = useState(1),
    [judgeIterations, setJudgeIterations] = useState(2),
    [imageSize, setImageSize] =
      useState<RuntimeSettings["generationDefaults"]["imageSize"]>("1024x1024"),
    [briefSubmitting, setBriefSubmitting] = useState(false);
  const briefing = briefSubmitting;
  async function generateBrief() {
    setBriefSubmitting(true);
    setError("");
    try {
      const result = await request(
        `projects/${projectId}/model-brief`,
        json({
          count: modelCount,
          hint: modelBrief,
        }),
      );
      setModelBrief(result.brief);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBriefSubmitting(false);
    }
  }
  async function load() {
    const d = await request("projects/" + projectId);
    setData(d);
    return d;
  }
  useEffect(() => {
    void request<{ settings: RuntimeSettings }>("settings")
      .then(({ settings }) => {
        setModelCount(settings.generationDefaults.count);
        setJudgeIterations(settings.generationDefaults.judgeIterations);
        setImageSize(settings.generationDefaults.imageSize);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setData(undefined);
    setVersion(-1);
    setDesign("");
    setEditing(false);
    setPreviewModelId(null);
    setFilter("all");
    setQuery("");
    setModelBrief("");
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
    }
  }, [data, version]);
  async function save(approve: boolean) {
    setBusy(true);
    setError("");
    try {
      await request(
        `projects/${projectId}/design`,
        json({ design, version, approve }, "PUT"),
      );
      const d = await load();
      setVersion(d.project.designVersion);
      setDesign(d.project.design);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function build(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget);
      await request(
        `projects/${projectId}/generate`,
        json({
          prompt: f.get("prompt"),
          count: Number(f.get("count")),
          judgeIterations:
            data.project.assetType === "graphic"
              ? 0
              : Number(f.get("iterations")),
          imageSize:
            data.project.assetType === "graphic"
              ? f.get("imageSize")
              : "1024x1024",
        }),
      );
      setGenerate(false);
      setTab("models");
      await load();
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
  const designChanged = design !== p.design;
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
  const activeTab = !ready && tab === "models" ? "design" : tab;
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
      <Tabs value={activeTab} onValueChange={setTab} className="workspace-tabs">
        <TabsList variant="line" className="tabs" aria-label="Project views">
          {[
            [
              "models",
              isGraphics ? "Graphics" : "3D assets",
              isGraphics ? ImageIcon : Boxes,
            ],
            ["design", "Design reference", FileText],
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
                design.
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
                  {editing && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setDesign(p.design);
                        setVersion(p.designVersion);
                        setEditing(false);
                      }}
                    >
                      Discard edits
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy || !designChanged || design.length < 100}
                    onClick={() => save(false)}
                  >
                    Save as draft
                  </Button>
                  <Button
                    variant="default"
                    className=""
                    disabled={busy || design.length < 100}
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
                <div className="eyebrow">VISUAL REFERENCES</div>
                <div className="reference-grid">
                  {p.references.map((f: string) => (
                    <a
                      href={fileUrl(f)}
                      key={f}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <AssetImage src={fileUrl(f)} alt="Project reference" />
                    </a>
                  ))}
                </div>
                {!p.references.length && (
                  <p className="muted">
                    This project starts from a written brief.
                  </p>
                )}
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
                            busy || !["ready", "review"].includes(p.status)
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
                            {m.branchKind === "fork" ? "Forked variant" : "Prompt iteration"}
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
      <Dialog
        open={generate}
        onOpenChange={(open) => {
          if (!open && !busy && !briefing) setGenerate(false);
        }}
      >
        <DialogContent showCloseButton={!busy && !briefing}>
          <DialogHeader>
            <div className="eyebrow">EXPAND YOUR COLLECTION</div>
            <DialogTitle className="text-[27px]">
              What should we create?
            </DialogTitle>
            <DialogDescription className="muted">
              Agents will follow design v{p.designVersion}. Give them specifics,
              or let them propose the set.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={build}>
            <div className="form-row">
              <Label>
                Number of {assetPlural}
                <Input
                  name="count"
                  type="number"
                  min={1}
                  max={20}
                  value={modelCount}
                  disabled={briefing}
                  onChange={(e) => setModelCount(e.target.valueAsNumber)}
                  required
                />
              </Label>
              {isGraphics ? (
                <Label>
                  Canvas
                  <Select
                    name="imageSize"
                    value={imageSize}
                    onValueChange={(value: typeof imageSize) =>
                      setImageSize(value)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1024x1024">Square</SelectItem>
                      <SelectItem value="1024x1536">Portrait</SelectItem>
                      <SelectItem value="1536x1024">Landscape</SelectItem>
                    </SelectContent>
                  </Select>
                </Label>
              ) : (
                <Label>
                  Review rounds per stage
                  <Input
                    name="iterations"
                    type="number"
                    min={0}
                    max={5}
                    value={judgeIterations}
                    onChange={(event) =>
                      setJudgeIterations(event.target.valueAsNumber)
                    }
                    required
                  />
                </Label>
              )}
            </div>
            <div className="brief-field">
              <div className="field-heading">
                <Label htmlFor="model-brief">
                  {isGraphics ? "Graphic" : "Model"} brief (optional)
                </Label>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={
                    busy ||
                    briefing ||
                    !Number.isInteger(modelCount) ||
                    modelCount < 1 ||
                    modelCount > 20
                  }
                  onClick={() => generateBrief()}
                >
                  {briefing ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <FileText size={16} />
                  )}
                  {briefing ? "Writing brief…" : "Draft brief with AI"}
                </Button>
              </div>
              <MarkdownTextarea
                id="model-brief"
                name="prompt"
                value={modelBrief}
                onChange={(e) => setModelBrief(e.target.value)}
                disabled={briefing}
                maxLength={12000}
                rows={5}
                placeholder={`Describe specific ${assetPlural}, or leave blank to let AI choose from your approved design.`}
              />
            </div>
            {briefing && (
              <p role="status" className="muted">
                Writing a brief from your approved design…
              </p>
            )}
            <p className="note">
              {isGraphics
                ? "Each graphic is generated on your chosen canvas and saved as a PNG. Usage is recorded in Activity & cost."
                : judgeIterations === 0
                  ? "No judging: each model still gets blockout, shape refinement, materials and polish, with photographs. It will finish without a review score."
                  : `Up to ${judgeIterations} review round${judgeIterations === 1 ? "" : "s"} for geometry, then ${judgeIterations} for materials. Passing ends review early; geometry must pass before materials begin. More rounds can increase time and cost.`}
            </p>
            {error && (
              <Alert variant="destructive" className="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button
              variant="default"
              className="wide"
              disabled={busy || briefing}
            >
              <Play size={17} />
              {busy ? "Queueing artists…" : "Start generation"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
