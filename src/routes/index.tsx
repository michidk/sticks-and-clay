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
import { Progress } from "../components/progress";
export const Route = createFileRoute("/")({ component: ProjectsPage });
function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [files, setFiles] = useState<File[]>([]);
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
        <button className="primary" onClick={() => setCreating(true)}>
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
          <button className="new-card" onClick={() => setCreating(true)}>
            <span className="circle">
              <Plus size={24} />
            </span>
            <strong>A new world starts here</strong>
            <span>Start with a name. Add a brief or moodboard if you like.</span>
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
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              <X />
            </button>
            <div className="eyebrow">START A COLLECTION</div>
            <h2 id="new-project-title">Give your world a direction.</h2>
            <p className="muted">
              Your designer can start from just the project name and generate an editable design brief.
            </p>
            <form onSubmit={create}>
              <label>
                Project name
                <input
                  name="name"
                  required
                  maxLength={100}
                  placeholder="e.g. Stonehaven village"
                />
              </label>
              <label>
                The brief (optional)
                <textarea
                  name="description"
                  rows={4}
                  placeholder="Leave empty to generate from the project name, or describe the setting, style, and what you want to build…"
                />
              </label>
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
              <button className="primary wide" disabled={busy}>
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
