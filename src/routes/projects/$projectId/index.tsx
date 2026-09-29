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
  X,
  Play,
  LoaderCircle,
} from "lucide-react";
import { request, json, money, fileUrl } from "../../../lib/client";
import { useDialog } from "../../../components/use-dialog";
import { Progress } from "../../../components/progress";
import { History } from "./-components/history";
const Viewer = lazy(() => import("./-components/viewer"));
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
  useDialog(generate || Boolean(selected),()=>{setGenerate(false);setSelected(null);setSelectedVersion(null);},busy||briefing);
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
        <p>{error || "Opening project…"}</p>
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
            <span className={"badge " + p.status}>{p.status}</span>
          </div>
          <h1>{p.name}</h1>
          <p className="lede">
            {p.description ||
              "A visual direction, ready to become a collection."}
          </p>
        </div>
        <button
          className="primary"
          disabled={!ready}
          onClick={() => setGenerate(true)}
        >
          <Plus size={18} />
          Generate models
        </button>
      </section>
      <div className="stats">
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
          {total.unpriced > 0 && <small>+ {total.unpriced} requests awaiting cost</small>}
        </div>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {!["ready", "review"].includes(p.status) && (
        <section className="setup panel">
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
              <p className="error">{p.error}</p>
              <button
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
              </button>
            </>
          )}
        </section>
      )}
      {p.status === "review" && (
        <div className="review-banner">
          <span>
            <strong>Your design reference is ready.</strong> Review it before
            the artists get to work.
          </span>
          <button onClick={() => setTab("design")}>Review design →</button>
        </div>
      )}
      <nav className="tabs" aria-label="Project views">
        {[
          ["models", "Models", Boxes],
          ["design", "Design reference", FileText],
          ["history", "Activity & cost", Activity],
        ].map(([id, title, Icon]: any) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={17} />
            {title}
            {id === "history" && <span className="count">{rs.length}</span>}
          </button>
        ))}
      </nav>
      {tab === "design" && (
        <div className="design-layout">
          <section className="panel">
            <div className="section-title">
              <h2>design.md</h2>
              <button
                onClick={() => {
                  if (!editing) {
                    setDesign(p.design);
                    setVersion(p.designVersion);
                  }
                  setEditing(!editing);
                }}
              >
                {editing ? "Preview" : "Edit design"}
              </button>
            </div>
            {editing ? (
              <textarea
                className="design-editor"
                aria-label="Design reference"
                value={design}
                onChange={(e) => setDesign(e.target.value)}
              />
            ) : (
              <div className="markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {design ||
                    p.design ||
                    "Your designer is preparing this document."}
                </ReactMarkdown>
              </div>
            )}
            {p.design && (
              <div className="actions">
                <button
                  disabled={busy || design.length < 100}
                  onClick={() => save(false)}
                >
                  Save draft
                </button>
                <button
                  className="primary"
                  disabled={busy || design.length < 100}
                  onClick={() => save(true)}
                >
                  <Check size={17} />
                  {busy ? "Saving…" : "Save & approve design"}
                </button>
              </div>
            )}
          </section>
          <aside>
            <section className="panel">
              <div className="eyebrow">VISUAL REFERENCES</div>
              <div className="reference-grid">
                {p.references.map((f: string) => (
                  <a href={fileUrl(f)} key={f} target="_blank" rel="noreferrer">
                    <img src={fileUrl(f)} alt="Project reference" />
                  </a>
                ))}
              </div>
              {!p.references.length && (
                <p className="muted">
                  This project starts from a written brief.
                </p>
              )}
            </section>
            <section className="panel">
              <h3>Design history</h3>
              <p className="muted">Every generation uses a saved snapshot.</p>
              {data.revisions.map((r: any) => (
                <details key={r.id}>
                  <summary>
                    Version {r.version} · {r.author}
                  </summary>
                  <div className="markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {r.content}
                    </ReactMarkdown>
                  </div>
                  <details>
                    <summary>Compare with current version</summary>
                    <pre className="revision-diff">
                      {diffLines(r.content, p.design).map((part, i) => (
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
                      ))}
                    </pre>
                    <small>
                      Green: added in current version. Red: removed from this
                      version.
                    </small>
                  </details>
                  <button
                    disabled={busy || !["ready", "review"].includes(p.status)}
                    onClick={() => {
                      setDesign(r.content);
                      setVersion(p.designVersion);
                      setEditing(true);
                    }}
                  >
                    Restore as draft
                  </button>
                </details>
              ))}
            </section>
          </aside>
        </div>
      )}
      {tab === "history" && <History runs={rs} models={data.models} />}
      {tab === "models" && (
        <>
          <div className="section-title">
            <h2>
              Your collection{" "}
              <span className="count">{data.models.length}</span>
            </h2>
          </div>
          {data.batches
            .filter((b: any) =>
              ["queued", "planning", "failed"].includes(b.status),
            )
            .map((b: any) => (
              <div key={b.id} className="panel">
                <strong>
                  {b.status === "failed"
                    ? "Batch failed"
                    : "Planning your collection"}
                </strong>
                <p>{b.prompt}</p>
                {b.status === "failed" && (
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await request("batches/" + b.id + "/resume", json({}));
                        await load();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Resume batch
                  </button>
                )}
                {b.error ? (
                  <p className="error">{b.error}</p>
                ) : (
                  <Progress
                    value={b.status === "queued" ? 0 : 20}
                    label={`${b.count} models · ${b.status}`}
                  />
                )}
              </div>
            ))}
          {data.batches
            .filter((b: any) => b.preview)
            .map((b: any) => (
              <section className="panel collection-preview" key={b.id}>
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
                    <img
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
                    <img
                      src={fileUrl(b.preview.scene)}
                      alt="Collection demo scene"
                    />
                    <span>Demo scene</span>
                  </a>
                </div>
              </section>
            ))}
          {!data.models.length && !data.batches.length ? (
            <div className="empty">
              <div className="circle">
                <Boxes size={32} />
              </div>
              <h2>Your collection is a blank canvas.</h2>
              <p>
                {ready
                  ? "Describe a model, or ask your agents to invent a cohesive set."
                  : "Start by reviewing and approving your project design."}
              </p>
              <button
                className="primary"
                onClick={() => (ready ? setGenerate(true) : setTab("design"))}
              >
                {ready ? "Create your first models" : "Open design reference"}
                <ArrowLeft style={{ transform: "rotate(180deg)" }} size={16} />
              </button>
            </div>
          ) : (
            <div className="model-grid">
              {data.models.map((m: any) => {
                const cost = rs
                  .filter((r: any) => r.modelId === m.id)
                  .reduce((a: number, r: any) => a + (r.estimatedCost || 0), 0);
                return (
                  <article key={m.id} className="model-card">
                    <button
                      className="model-cover"
                      disabled={!m.artifacts}
                      onClick={() => {
                        setSelected(m);
                        setView("3d");
                      }}
                    >
                      {m.artifacts ? (
                        <img
                          src={fileUrl(m.artifacts.renders[0])}
                          alt={m.name}
                        />
                      ) : (
                        <div className="abstract">
                          <Boxes size={56} strokeWidth={1} />
                          {!["failed", "done", "cancelled"].includes(
                            m.status,
                          ) && <LoaderCircle className="spin" size={20} />}
                        </div>
                      )}
                      <span
                        className={
                          "badge " +
                          (m.verdict === "limit_reached" ? "warning" : m.status)
                        }
                      >
                        {m.verdict === "limit_reached"
                          ? "Completed with issues"
                          : m.verdict === "approved"
                            ? "Approved"
                            : m.status}
                      </span>
                      {m.artifacts && (
                        <span className="orbit-label">Explore in 3D ↗</span>
                      )}
                    </button>
                    <div className="project-body">
                      <h3>{m.name}</h3>
                      <p>{m.prompt}</p>
                      {!["done", "failed", "cancelled"].includes(m.status) && (
                        <Progress value={m.progress} label={m.phase} />
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
                      <button
                        onClick={() => {
                          setSelected(m);
                          setSelectedVersion(null);
                          setView("history");
                        }}
                      >
                        Iteration history
                      </button>
                      {m.error && <p className="error">{m.error}</p>}
                      {m.status === "failed" && (
                        <button
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
                        </button>
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
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      {generate && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="generate-title"
          >
            <button
              className="icon close"
              aria-label="Close"
              disabled={busy}
              onClick={() => setGenerate(false)}
            >
              <X />
            </button>
            <div className="eyebrow">EXPAND YOUR COLLECTION</div>
            <h2 id="generate-title">What should we build?</h2>
            <p className="muted">
              Artists will follow design v{p.designVersion}. Give them
              specifics, or let them propose the set.
            </p>
            <form onSubmit={build}>
              <label>
                Model brief
                <textarea
                  name="prompt"
                  value={modelBrief}
                  onChange={(e) => setModelBrief(e.target.value)}
                  disabled={briefing}
                  required
                  minLength={10}
                  rows={5}
                  placeholder="e.g. Create five distinct village walls: a plain section, an archway, a damaged section…"
                />
              </label>
              <div className="actions">
                <button
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
                </button>
              </div>
              {briefing && (
                <p role="status" className="muted">
                  Writing a brief from your approved design…
                </p>
              )}
              <p className="note">
                Uses your approved design, model count, and any draft above.
                Review and edit the result before starting generation.
              </p>
              <div className="form-row">
                <label>
                  Number of models
                  <input
                    name="count"
                    type="number"
                    min={1}
                    max={20}
                    value={modelCount}
                    disabled={briefing}
                    onChange={(e) => setModelCount(e.target.valueAsNumber)}
                    required
                  />
                </label>
                <label>
                  Maximum judge rounds
                  <input
                    name="iterations"
                    type="number"
                    min={0}
                    max={5}
                    defaultValue={2}
                    required
                  />
                </label>
              </div>
              <p className="note">
                Each round builds and visually reviews the model. Failed reviews
                lead to another build while rounds remain. Passing models finish
                early. Zero skips judging.
              </p>
              {error && <p className="error">{error}</p>}
              <button className="primary wide" disabled={busy || briefing}>
                <Play size={17} />
                {busy ? "Queueing artists…" : "Start generation"}
              </button>
            </form>
          </section>
        </div>
      )}
      {selected && (
        <div className="overlay">
          <section
            className="asset-modal"
            role="dialog"
            aria-modal="true"
            aria-label={selected.name}
          >
            <button
              className="icon close"
              aria-label="Close viewer"
              onClick={() => {
                setSelected(null);
                setSelectedVersion(null);
              }}
            >
              <X />
            </button>
            <div className="asset-title">
              <h2>{selected.name}</h2>
              <div className="tabs compact">
                <button
                  className={view === "history" ? "active" : ""}
                  onClick={() => setView("history")}
                >
                  History
                </button>
                <button
                  className={view === "3d" ? "active" : ""}
                  onClick={() => setView("3d")}
                >
                  <Boxes size={16} />
                  3D model
                </button>
                <button
                  className={view === "renders" ? "active" : ""}
                  onClick={() => setView("renders")}
                >
                  <ImageIcon size={16} />
                  Renders
                </button>
                <button className={view === "textures" ? "active" : ""} onClick={() => setView("textures")}>Textures</button>
              </div>
            </div>
            <section className="panel">
              <h3>Iteration history</h3>
              <label>
                Viewing version
                <select
                  value={selectedVersion || ""}
                  onChange={(e) => setSelectedVersion(e.target.value || null)}
                >
                  <option value="">Latest version</option>
                  {modelVersions
                    .filter((v: any) => v.artifacts)
                    .map((v: any) => (
                      <option key={v.id} value={v.id}>
                        Iteration {v.iteration + 1} ·{" "}
                        {new Date(v.createdAt).toLocaleString()}
                      </option>
                    ))}
                </select>
              </label>
              {modelVersions.map((v: any) => (
                <details key={v.id}>
                  <summary>
                    Iteration {v.iteration + 1} · {v.status} ·{" "}
                    {new Date(v.createdAt).toLocaleString()}
                  </summary>
                  <p>{v.summary || v.error}</p>
                  {v.artifacts && (
                    <div className="actions">
                      <button
                        onClick={() => {
                          setSelectedVersion(v.id);
                          setView("renders");
                        }}
                      >
                        View this version
                      </button>
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
                        {j.result?.improvements?.map((i: any, n: number) => (
                          <p key={n}>
                            <b>{i.priority}</b> · {i.view}: {i.issue}
                            <br />
                            {i.action}
                          </p>
                        ))}
                      </div>
                    ))
                  ) : (
                    <p className="muted">No judge review for this attempt.</p>
                  )}
                </details>
              ))}
            </section>
            {shownArtifacts && view !== "history" && (
              <>
                {view === "textures" ? (
                  <section>
                    <h3>Texture images</h3>
                    <p className="muted">Generated sources and texture maps embedded in this version’s GLB.</p>
                    {!shownArtifacts.textures?.length && <p>No separate texture images were archived for this version.</p>}
                    <div className="render-grid">{shownArtifacts.textures?.map((texture: any) => <a key={texture.key} href={fileUrl(texture.key)} target="_blank" rel="noreferrer"><img src={fileUrl(texture.key)} alt={texture.name} /><strong>{texture.name}</strong><p>{texture.kind} · Open / download</p></a>)}</div>
                  </section>
                ) : view === "3d" ? (
                  <Suspense
                    fallback={<div className="viewer">Loading viewer…</div>}
                  >
                    <Viewer url={fileUrl(shownArtifacts.glb)} />
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
                        <img src={fileUrl(r)} alt={r.split("/").pop()} />
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
                    <span className="badge warning">{i.priority}</span>{" "}
                    {i.issue} — {i.action}
                  </p>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
