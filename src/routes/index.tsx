import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Plus,
  ArrowUpRight,
  Layers,
  ImagePlus,
  X,
  LoaderCircle,
} from "lucide-react";
import { request, money, fileUrl } from "../lib/client";
import { useDialog } from "../components/use-dialog";
import { Progress } from "../components/progress";
export const Route = createFileRoute("/")({ component: ProjectsPage });
function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [triangleBudget, setTriangleBudget] = useState(""),
    [draftId, setDraftId] = useState<string | null>(null),
    [briefing, setBriefing] = useState(false);
  function newProject() {
    setName("");
    setDescription("");
    setTriangleBudget("");
    setDraftId(null);
    setFiles([]);
    setCreating(true);
  }
  async function generateBrief() {
    setBriefing(true);
    setError("");
    try {
      const form = new FormData();
      form.set("name", name);
      form.set("description", description);
      form.set("triangleBudget", triangleBudget);
      if (draftId) form.set("draftId", draftId);
      for (const file of files) form.append("images", file);
      const result = await request("projects/brief", {
        method: "POST",
        body: form,
      });
      setDraftId(result.id);
      setDescription(result.brief);
    } catch (e) {
      if ((e as any).data?.draftId) setDraftId((e as any).data.draftId);
      setError((e as Error).message);
    } finally {
      setBriefing(false);
    }
  }
  useDialog(creating, () => setCreating(false), busy || briefing);
  const navigate = Route.useNavigate();
  useEffect(() => {
    let active = true;
    const load = () =>
      request("projects")
        .then((d) => {
          if (active) {
            setProjects(d.projects);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (active) {
            setError(e.message);
            setLoading(false);
          }
        });
    void load();
    const t = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget);
      if (draftId) form.set("draftId", draftId);
      form.delete("images");
      for (const file of files) form.append("images", file);
      const p = await request("projects", { method: "POST", body: form });
      await navigate({
        to: "/projects/$projectId",
        params: { projectId: p.id },
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <div className="eyebrow">YOUR CREATIVE WORKSPACE</div>
      <section className="page-heading">
        <div>
          <h1>
            Build a world.
            <br />
            <em>Keep it consistent.</em>
          </h1>
          <p className="lede">
            Turn references into a shared design language.
            <br />
            Let your agents build, review, and refine the details.
          </p>
        </div>
        <button className="primary" onClick={newProject}>
          <Plus size={18} />
          New project
        </button>
      </section>
      <div className="section-title">
        <h2>
          Projects <span className="count">{projects.length}</span>
        </h2>
        <span>Every collection starts with a direction.</span>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {loading ? (
        <p className="muted">Loading your workspace…</p>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <Link
              key={p.id}
              to="/projects/$projectId"
              params={{ projectId: p.id }}
              className="project-card"
              onClick={
                p.status === "draft"
                  ? (e) => {
                      e.preventDefault();
                      setName(p.name);
                      setDescription(p.description);
                      setTriangleBudget(p.triangleBudget?.toString() || "");
                      setDraftId(p.id);
                      setFiles([]);
                      setCreating(true);
                    }
                  : undefined
              }
            >
              <div className="project-cover">
                {p.references[0] ? (
                  <img
                    src={fileUrl(p.references[0])}
                    alt={`${p.name} reference`}
                  />
                ) : (
                  <div className="abstract">
                    <Layers size={68} strokeWidth={0.8} />
                    <span>STYLE STARTS HERE</span>
                  </div>
                )}
                <span className={"badge " + p.status}>
                  {p.status.replace("_", " ")}
                </span>
              </div>
              <div className="project-body">
                <h3>
                  {p.name}
                  <ArrowUpRight size={19} />
                </h3>
                <p>
                  {p.description ||
                    "A collection inspired by its name and references."}
                </p>
                {["queued", "designing"].includes(p.status) && (
                  <Progress value={p.progress} label={p.phase} />
                )}
                <div className="card-meta">
                  <span>
                    {new Date(p.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span>
                    {p.usage.tokens.toLocaleString()} tokens ·{" "}
                    {money(p.usage.cost)}
                  </span>
                </div>
              </div>
            </Link>
          ))}
          <button className="new-card" onClick={newProject}>
            <span className="circle">
              <Plus size={24} />
            </span>
            <strong>A new world starts here</strong>
            <span>Name your project, then write or generate its brief.</span>
          </button>
        </div>
      )}
      <div className="how">
        <div>
          <b>01</b>
          <h3>Set the direction</h3>
          <p>A design reference you can shape and approve.</p>
        </div>
        <div>
          <b>02</b>
          <h3>Build together</h3>
          <p>Parallel artists, one consistent visual language.</p>
        </div>
        <div>
          <b>03</b>
          <h3>Review every detail</h3>
          <p>Visual judging, concrete fixes, full history.</p>
        </div>
      </div>
      {creating && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
          >
            <button
              className="icon close"
              aria-label="Close"
              disabled={busy || briefing}
              onClick={() => setCreating(false)}
            >
              <X />
            </button>
            <div className="eyebrow">START A COLLECTION</div>
            <h2 id="new-project-title">Give your world a direction.</h2>
            <p className="muted">
              Write a brief or let AI draft one from the name and references.
              Review it before creating your design.
            </p>
            <form onSubmit={create}>
              <label>
                Project name
                <input
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={briefing}
                  required
                  maxLength={100}
                  placeholder="e.g. Stonehaven village"
                />
              </label>
              <label>
                The brief
                <textarea
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={briefing}
                  required
                  minLength={10}
                  rows={4}
                  placeholder="Describe the setting, style, and what you want to build, or use AI generate brief."
                />
              </label>
              <button
                type="button"
                disabled={busy || briefing || !name.trim()}
                onClick={generateBrief}
              >
                {briefing && <LoaderCircle className="spin" size={16} />}
                {briefing ? "Writing brief…" : "AI generate brief"}
              </button>
              <p className="note">
                The generated text fills the field above. Edit and correct it
                before continuing.
              </p>
              <label className="upload">
                <ImagePlus size={24} />
                <strong>Reference images (optional)</strong>
                <span>Choose up to 6 PNG, JPG or WebP images · 8 MB each</span>
                <input
                  name="images"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(e) =>
                    setFiles(Array.from(e.target.files || []).slice(0, 6))
                  }
                />
              </label>
              {files.length > 0 && (
                <p className="muted">{files.map((f) => f.name).join(" · ")}</p>
              )}
              {error && <p className="error">{error}</p>}
              <label>Triangle budget per asset (optional)
                <input type="number" name="triangleBudget" min="1" max="100000000" step="1" value={triangleBudget} onChange={e => setTriangleBudget(e.target.value)} placeholder="No limit specified" />
              </label>
              <button className="primary wide" disabled={busy || briefing}>
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Plus size={18} />
                )}{" "}
                {busy
                  ? "Creating project…"
                  : "Create project & generate design"}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
