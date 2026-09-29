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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
  Image as ImageIcon,
  Activity,
  FileText,
  Play,
  LoaderCircle,
} from "lucide-react";
import { request, json, money, fileUrl } from "../../../lib/client";
import { Progress } from "../../../components/progress";
import { History } from "./-components/history";
const Viewer = lazy(() => import("@/components/model-viewer").then((module) => ({ default: module.ModelViewer })));
export const Route = createFileRoute("/projects/$projectId/")({
  component: ProjectPage,
});
function ProjectPage() {
  const { projectId } = Route.useParams();
  const [data, setData] = useState<any>(),
    [tab, setTab] = useState("models"),
    [error, setError] = useState(""),
    [design, setDesign] = useState(""),
    [version, setVersion] = useState(-1),
    [editing, setEditing] = useState(false),
    [generate, setGenerate] = useState(false),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<any>(),
    [view, setView] = useState("3d"),
    [selectedVersion, setSelectedVersion] = useState<string | null>(null),
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
    setSelected(undefined);
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
  useEffect(() => {
    if (data)
      setSelected((current: any) =>
        current
          ? (data.models.find((m: any) => m.id === current.id) ?? current)
          : current,
      );
  }, [data]);
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
  const modelVersions =
    data.versions?.filter((v: any) => v.modelId === selected?.id) || [];
  const historicalVersion = modelVersions.find(
    (v: any) => v.id === selectedVersion,
  );
  const shownArtifacts = historicalVersion?.artifacts || selected?.artifacts;
  const shownFeedback = historicalVersion
    ? historicalVersion.judges?.find((j: any) => j.result)?.result
    : selected?.feedback;
  const completed = data.models.filter((m: any) => m.status === "done").length;
  return (
    <main>
      <Link to="/" className="back">
        <ArrowLeft size={15} />
        All projects
      </Link>
      <section className="project-heading">
        <div>
          <div className="eyebrow">
            PROJECT WORKSPACE{" "}
            <Badge variant="secondary" className={"badge " + p.status}>
              {p.status}
            </Badge>
          </div>
          <h1>{p.name}</h1>
          <p className="lede">
            {p.description ||
              "A visual direction, ready to become a collection."}
          </p>
        </div>
        <Button
          variant="default"
          className=""
          disabled={!ready}
          onClick={() => setGenerate(true)}
        >
          <Plus size={18} />
          Generate models
        </Button>
      </section>
      <Card className="stats">
        <div>
          <span>COLLECTION</span>
          <strong>
            {completed}
            <small> / {data.models.length} models</small>
          </strong>
        </div>
        <div>
          <span>DESIGN REFERENCE</span>
          <strong>
            {p.designVersion ? (
              <>
                <small>Version </small>
                {p.designVersion}
              </>
            ) : (
              "In progress"
            )}
          </strong>
        </div>
        <div>
          <span>TOKEN USAGE</span>
          <strong>
            {total.tokens.toLocaleString()}
            <small>
              {rs.some((r: any) =>
                ["estimated", "mixed"].includes(r.usageSource),
              )
                ? " · includes estimates"
                : ""}
            </small>
          </strong>
        </div>
        <div>
          <span>ESTIMATED MODEL COST</span>
          <strong>{money(total.cost)}</strong>
          {total.unpriced > 0 && (
            <small>+ {total.unpriced} requests awaiting cost</small>
          )}
        </div>
      </Card>
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
            <div className="section-title">
              <h2>
                Your collection{" "}
                <Badge variant="secondary" className="count">
                  {data.models.length}
                </Badge>
              </h2>
            </div>
            {data.batches
              .filter((b: any) =>
                ["queued", "planning", "failed"].includes(b.status),
              )
              .map((b: any) => (
                <Card key={b.id} className="panel">
                  <strong>
                    {b.status === "failed"
                      ? "Batch failed"
                      : "Planning your collection"}
                  </strong>
                  <p>{b.prompt}</p>
                  {b.status === "failed" && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          await request(
                            "batches/" + b.id + "/resume",
                            json({}),
                          );
                          await load();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Resume batch
                    </Button>
                  )}
                  {b.error ? (
                    <Alert variant="destructive" className="error">
                      <AlertDescription>{b.error}</AlertDescription>
                    </Alert>
                  ) : (
                    <Progress
                      value={b.status === "queued" ? 0 : 20}
                      label={`${b.count} models · ${b.status}`}
                    />
                  )}
                </Card>
              ))}
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
                {data.models.map((m: any) => {
                  const cost = rs
                    .filter((r: any) => r.modelId === m.id)
                    .reduce(
                      (a: number, r: any) => a + (r.estimatedCost || 0),
                      0,
                    );
                  return (
                    <Card key={m.id} className="model-card">
                      <Button
                        variant="ghost"
                        size="bare"
                        className="model-cover"
                        disabled={!m.artifacts}
                        onClick={() => {
                          setSelected(m);
                          setView("3d");
                        }}
                      >
                        {m.artifacts ? (
                          <AssetImage
                            src={fileUrl(m.artifacts.renders[0])}
                            alt={m.name}
                          />
                        ) : (
                          <div className="abstract">
                            <Boxes size={56} strokeWidth={1} />
                            {!["failed", "done", "cancelled"].includes(
                              m.status,
                            ) && (
                              <Skeleton className="absolute inset-0 rounded-none" />
                            )}
                          </div>
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
                        {m.artifacts && (
                          <span className="orbit-label">Explore in 3D ↗</span>
                        )}
                      </Button>
                      <div className="project-body">
                        <h3>{m.name}</h3>
                        <p>{m.prompt}</p>
                        {!["done", "failed", "cancelled"].includes(
                          m.status,
                        ) && <Progress value={m.progress} label={m.phase} />}
                        <div className="card-meta">
                          <span>
                            {m.artifacts
                              ? m.artifacts.metrics.triangles.toLocaleString() +
                                " tris"
                              : m.phase}
                          </span>
                          <span>{money(cost)}</span>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setSelected(m);
                            setSelectedVersion(null);
                            setView("history");
                          }}
                        >
                          Iteration history
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
              Each round builds and visually reviews the model. Failed reviews
              lead to another build while rounds remain. Passing models finish
              early. Zero skips judging.
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
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setSelectedVersion(null);
          }
        }}
      >
        {selected && (
          <DialogContent
            className="max-w-[1000px]"
            aria-describedby={undefined}
          >
            <div className="asset-title">
              <DialogTitle>{selected.name}</DialogTitle>
              <Tabs
                value={view}
                onValueChange={setView}
                className="workspace-tabs"
              >
                <TabsList
                  variant="line"
                  className="tabs compact"
                  aria-label="Asset views"
                >
                  <TabsTrigger value="history">History</TabsTrigger>
                  <TabsTrigger value="3d">
                    <Boxes size={16} />
                    3D model
                  </TabsTrigger>
                  <TabsTrigger value="renders">
                    <ImageIcon size={16} />
                    Renders
                  </TabsTrigger>
                  <TabsTrigger value="textures">Textures</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Card className="panel">
              <h3>Iteration history</h3>
              <Label>
                Viewing version
                <Select
                  value={selectedVersion || "latest"}
                  onValueChange={(value) =>
                    setSelectedVersion(value === "latest" ? null : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Latest version" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="latest">Latest version</SelectItem>
                    {modelVersions
                      .filter((v: any) => v.artifacts)
                      .map((v: any) => (
                        <SelectItem key={v.id} value={v.id}>
                          Iteration {v.iteration + 1} ·{" "}
                          {new Date(v.createdAt).toLocaleString()}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Label>
              {modelVersions.map((v: any) => (
                <Accordion type="single" collapsible key={v.id}>
                  <AccordionItem value="content">
                    <AccordionTrigger>
                      Iteration {v.iteration + 1} · {v.status} ·{" "}
                      {new Date(v.createdAt).toLocaleString()}
                    </AccordionTrigger>
                    <AccordionContent>
                      <p>{v.summary || v.error}</p>
                      {v.artifacts && (
                        <div className="actions">
                          <Button
                            variant="outline"
                            onClick={() => {
                              setSelectedVersion(v.id);
                              setView("renders");
                            }}
                          >
                            View this version
                          </Button>
                          <a href={fileUrl(v.artifacts.glb)} download>
                            GLB
                          </a>
                          <a href={fileUrl(v.artifacts.blend)} download>
                            Blender source
                          </a>
                        </div>
                      )}
                      {!v.artifacts && (
                        <p className="muted">
                          No verified export saved for this attempt.
                        </p>
                      )}
                      {v.judges.length ? (
                        v.judges.map((j: any) => (
                          <div key={j.id} className="judge-feedback">
                            <strong>
                              Judge ·{" "}
                              {j.result
                                ? `${j.result.score}/100 · ${j.result.passed ? "Passed" : "Changes requested"}`
                                : j.status}
                            </strong>
                            <p>{j.result?.summary || j.error}</p>
                            {j.result?.improvements?.map(
                              (i: any, n: number) => (
                                <p key={n}>
                                  <b>{i.priority}</b> · {i.view}: {i.issue}
                                  <br />
                                  {i.action}
                                </p>
                              ),
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="muted">
                          No judge review for this attempt.
                        </p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              ))}
            </Card>
            {shownArtifacts && view !== "history" && (
              <>
                {view === "textures" ? (
                  <section>
                    <h3>Texture images</h3>
                    <p className="muted">
                      Generated sources and texture maps embedded in this
                      version’s GLB.
                    </p>
                    {!shownArtifacts.textures?.length && (
                      <p>
                        No separate texture images were archived for this
                        version.
                      </p>
                    )}
                    <div className="render-grid">
                      {shownArtifacts.textures?.map((texture: any) => (
                        <a
                          key={texture.key}
                          href={fileUrl(texture.key)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <AssetImage
                            src={fileUrl(texture.key)}
                            alt={texture.name}
                          />
                          <strong>{texture.name}</strong>
                          <p>{texture.kind} · Open / download</p>
                        </a>
                      ))}
                    </div>
                  </section>
                ) : view === "3d" ? (
                  <Suspense fallback={<ViewerSkeleton />}>
                    <Viewer src={fileUrl(shownArtifacts.glb)} alt={selected.name} />
                  </Suspense>
                ) : (
                  <div className="render-grid">
                    {shownArtifacts.renders.map((r: string) => (
                      <a
                        href={fileUrl(r)}
                        target="_blank"
                        rel="noreferrer"
                        key={r}
                      >
                        <AssetImage src={fileUrl(r)} alt={r.split("/").pop()} />
                      </a>
                    ))}
                  </div>
                )}
                <div className="asset-info">
                  <span>
                    {shownArtifacts.metrics.triangles.toLocaleString()}{" "}
                    triangles ·{" "}
                    {shownArtifacts.metrics.dimensions
                      .map((d: number) => d.toFixed(2))
                      .join(" × ")}{" "}
                    m
                  </span>
                  <a
                    className="button primary"
                    href={fileUrl(shownArtifacts.glb)}
                    download
                  >
                    <Download size={16} />
                    Download GLB
                  </a>
                </div>
              </>
            )}
            {shownFeedback && (
              <div className="judge-feedback">
                <strong>Judge · {shownFeedback.score}/100</strong>
                <p>{shownFeedback.summary}</p>
                {shownFeedback.improvements.map((i: any, n: number) => (
                  <p key={n}>
                    <Badge variant="secondary" className="badge warning">
                      {i.priority}
                    </Badge>{" "}
                    {i.issue} — {i.action}
                  </p>
                ))}
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
    </main>
  );
}
