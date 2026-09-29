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
  WorkspaceSkeleton,
  ViewerSkeleton,
  TextSkeleton,
} from "@/components/loading";
import { AssetImage } from "@/components/asset-image";
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
} from "lucide-react";
import { request, json, money, fileUrl } from "../../../lib/client";
import { Progress } from "../../../components/progress";
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
    setData(undefined);
    setVersion(-1);
    setDesign("");
    setEditing(false);
    setPreviewModelId(null);
    setFilter("all");
    setQuery("");
    setModelBrief("");
    setModelCount(1);
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
          judgeIterations: Number(f.get("iterations")),
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
  const total = rs.reduce(
    (a: any, r: any) => ({
      cost: a.cost + (r.estimatedCost || 0),
      unpriced: a.unpriced + (r.estimatedCost === null ? 1 : 0),
      tokens: a.tokens + r.inputTokens + r.outputTokens,
    }),
    { cost: 0, tokens: 0, unpriced: 0 },
  );
  const ready = p.status === "ready";
  const completed = data.models.filter((m: any) => m.status === "done").length;
  const pending = pendingCollectionItems(data.batches, data.models);
  const queuedCount = pending.filter((item) => item.placeholder).length;
  const working =
    data.models.filter(
      (m: any) => !["done", "failed", "cancelled"].includes(m.status),
    ).length + pending.filter((item) => item.batch.status !== "failed").length;
  const needsReview =
    data.models.filter(
      (m: any) => m.verdict === "limit_reached" || m.status === "failed",
    ).length + pending.filter((item) => item.batch.status === "failed").length;
  const matches = (text: string) =>
    text.toLowerCase().includes(query.toLowerCase().trim());
  const visibleModels = data.models.filter(
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
  return (
    <main className="project-overview">
      <Link to="/" className="back">
        <ArrowLeft size={15} />
        All projects
      </Link>
      <section className="overview-hero">
        <div className="overview-intro">
          <div className="eyebrow">
            YOUR CREATIVE WORKSHOP{" "}
            <Badge variant="secondary" className={"badge " + p.status}>
              {p.status}
            </Badge>
          </div>
          <h1>{p.name}</h1>
          <p className="overview-description">
            {p.description ||
              "One visual direction. A collection of possibilities."}
          </p>
          <div className="overview-actions">
            <Button disabled={!ready} onClick={() => setGenerate(true)}>
              <Plus size={17} /> Generate models
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
              Approve the design reference to start generating models.
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
      <div className="overview-metrics">
        <div>
          <strong>{data.models.length + queuedCount}</strong>
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
          <strong>{money(total.cost)}</strong>
          <span>
            estimated cost{total.unpriced ? ` · ${total.unpriced} pending` : ""}{" "}
            ↗
          </span>
        </button>
      </div>
      {error && (
        <Alert variant="destructive" role="alert" className="error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!["ready", "review"].includes(p.status) && (
        <Card className="setup panel">
          <h2>
            {p.status === "failed"
              ? "Setup needs attention"
              : "Finding your visual language"}
          </h2>
          <p className="muted">
            Your designer is reading the brief and references to create a shared
            direction.
          </p>
          <Progress value={p.progress} label={p.phase} />
          {p.error && (
            <>
              <Alert variant="destructive" className="error">
                <AlertDescription>{p.error}</AlertDescription>
              </Alert>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await request(
                      `projects/${projectId}/retry-design`,
                      json({}),
                    );
                    await load();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                Resume setup
              </Button>
            </>
          )}
        </Card>
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
      <Tabs value={tab} onValueChange={setTab} className="workspace-tabs">
        <TabsList variant="line" className="tabs" aria-label="Project views">
          {[
            ["models", "Models", Boxes],
            ["design", "Design reference", FileText],
            ["history", "Activity & cost", Activity],
          ].map(([id, title, Icon]: any) => (
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
        {tab === "design" && (
          <div className="design-layout">
            <Card className="panel">
              <div className="section-title">
                <h2>design.md</h2>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!editing) {
                      setDesign(p.design);
                      setVersion(p.designVersion);
                    }
                    setEditing(!editing);
                  }}
                >
                  {editing ? "Preview" : "Edit design"}
                </Button>
              </div>
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
              {p.design && (
                <div className="actions">
                  <Button
                    variant="outline"
                    disabled={busy || design.length < 100}
                    onClick={() => save(false)}
                  >
                    Save draft
                  </Button>
                  <Button
                    variant="default"
                    className=""
                    disabled={busy || design.length < 100}
                    onClick={() => save(true)}
                  >
                    <Check size={17} />
                    {busy ? "Saving…" : "Save & approve design"}
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
        {tab === "history" && <History runs={rs} models={data.models} />}
        {tab === "models" && (
          <>
            <div className="collection-heading">
              <div>
                <div className="eyebrow">MADE FOR THIS WORLD</div>
                <h2>
                  Your collection{" "}
                  <span>{data.models.length + queuedCount}</span>
                </h2>
              </div>
              <Input
                aria-label="Search collection"
                placeholder="Find a model…"
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
                ["all", "All models", data.models.length + queuedCount],
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
            {data.batches
              .filter((b: any) => b.preview)
              .map((b: any) => (
                <Card className="panel collection-preview" key={b.id}>
                  <div className="section-title">
                    <h2>Collection studio</h2>
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
                </Card>
              ))}
            {!data.models.length && !data.batches.length ? (
              <Empty className="empty">
                <div className="circle">
                  <Boxes size={32} />
                </div>
                <h2>Your collection is a blank canvas.</h2>
                <p>
                  {ready
                    ? "Describe a model, or ask your agents to invent a cohesive set."
                    : "Start by reviewing and approving your project design."}
                </p>
                <Button
                  variant="default"
                  className=""
                  onClick={() => (ready ? setGenerate(true) : setTab("design"))}
                >
                  {ready ? "Create your first models" : "Open design reference"}
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
                  />
                ))}
                {visibleModels.map((m: any) => {
                  const cost = rs
                    .filter((r: any) => r.modelId === m.id)
                    .reduce(
                      (a: number, r: any) => a + (r.estimatedCost || 0),
                      0,
                    );
                  return (
                    <Card key={m.id} className="model-card">
                      <div className="model-cover">
                        {previewModelId === m.id && m.artifacts ? (
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
                          <Link
                            to="/projects/$projectId/models/$modelId"
                            params={{ projectId, modelId: m.id }}
                            search={{ view: "3d", section: "review" }}
                          >
                            {m.name.replaceAll("_", " ")}
                          </Link>
                        </h3>
                        <p>{m.prompt}</p>
                        {m.artifacts && (
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
                        ) && <Progress value={m.progress} label={m.phase} />}
                        {m.artifacts?.stage === "geometry" && (
                          <p className="note">
                            Geometry preview · materials pending
                          </p>
                        )}
                        <div className="card-meta">
                          <span>
                            {m.artifacts
                              ? m.artifacts.metrics.triangles.toLocaleString() +
                                " tris"
                              : m.phase}
                          </span>
                          <span>{money(cost)}</span>
                        </div>
                        <Button variant="outline" asChild>
                          <Link
                            to="/projects/$projectId/models/$modelId"
                            params={{ projectId, modelId: m.id }}
                            search={{ view: "3d", section: "versions" }}
                          >
                            View model & history ↗
                          </Link>
                        </Button>
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
                            Resume model
                          </Button>
                        )}
                        {m.artifacts && (
                          <div className="downloads">
                            <a href={fileUrl(m.artifacts.glb)} download>
                              <Download size={14} />
                              GLB
                            </a>
                            <a href={fileUrl(m.artifacts.blend)} download>
                              Blender source
                            </a>
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
                {!visibleModels.length && !visiblePending.length && (
                  <Empty className="collection-no-results">
                    <h3>No matching models</h3>
                    <p>Try another search or filter.</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQuery("");
                        setFilter("all");
                      }}
                    >
                      Show all models
                    </Button>
                  </Empty>
                )}
              </div>
            )}
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
              What should we build?
            </DialogTitle>
            <DialogDescription className="muted">
              Artists will follow design v{p.designVersion}. Give them
              specifics, or let them propose the set.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={build}>
            <div className="form-row">
              <Label>
                Number of models
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
              <Label>
                Maximum judge rounds
                <Input
                  name="iterations"
                  type="number"
                  min={0}
                  max={5}
                  defaultValue={2}
                  required
                />
              </Label>
            </div>
            <div className="brief-field">
              <div className="field-heading">
                <Label htmlFor="model-brief">Model brief</Label>
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
                  {briefing ? "Writing brief…" : "AI generate brief"}
                </Button>
              </div>
              <Textarea
                id="model-brief"
                name="prompt"
                value={modelBrief}
                onChange={(e) => setModelBrief(e.target.value)}
                disabled={briefing}
                required
                minLength={10}
                rows={5}
                placeholder="e.g. Create five distinct village walls: a plain section, an archway, a damaged section…"
              />
            </div>
            {briefing && (
              <p role="status" className="muted">
                Writing a brief from your approved design…
              </p>
            )}
            <p className="note">
              A visual target comes first. Each stage allows this many
              build/review rounds: geometry must pass before surface work
              begins. Passing stages finish early. Zero makes one build with
              self-review only.
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
