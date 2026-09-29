import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CardsSkeleton } from "@/components/loading";
import { AssetImage } from "@/components/asset-image";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Plus,
  ArrowUpRight,
  Layers,
  ImagePlus,
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
        <Button variant="default" className="" onClick={newProject}>
          <Plus size={18} />
          New project
        </Button>
      </section>
      <div className="section-title">
        <h2>
          Projects{" "}
          <Badge variant="secondary" className="count">
            {projects.length}
          </Badge>
        </h2>
        <span>Every collection starts with a direction.</span>
      </div>
      {error && (
        <Alert variant="destructive" role="alert" className="error">
          {error}
        </Alert>
      )}
      {loading ? (
        <CardsSkeleton />
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <Card key={p.id} asChild className="project-card">
              <Link
                to="/projects/$projectId"
                params={{ projectId: p.id }}
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
                    <AssetImage
                      src={fileUrl(p.references[0])}
                      alt={`${p.name} reference`}
                    />
                  ) : (
                    <div className="abstract">
                      <Layers size={68} strokeWidth={0.8} />
                      <span>STYLE STARTS HERE</span>
                    </div>
                  )}
                  <Badge variant="secondary" className={"badge " + p.status}>
                    {p.status.replace("_", " ")}
                  </Badge>
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
            </Card>
          ))}
          <Button
            variant="ghost"
            size="bare"
            className="new-card"
            onClick={newProject}
          >
            <span className="circle">
              <Plus size={24} />
            </span>
            <strong>A new world starts here</strong>
            <span>Name your project, then write or generate its brief.</span>
          </Button>
        </div>
      )}
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!open && !busy && !briefing) setCreating(false);
        }}
      >
        <DialogContent showCloseButton={!busy && !briefing}>
          <DialogHeader>
            <div className="eyebrow">START A COLLECTION</div>
            <DialogTitle className="text-[27px]">
              Give your world a direction.
            </DialogTitle>
            <DialogDescription className="muted">
              Write a brief or let AI draft one from the name and references.
              Review it before creating your design.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={create}>
            <Label>
              Project name
              <Input
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={briefing}
                required
                maxLength={100}
                placeholder="e.g. Stonehaven village"
              />
            </Label>
            <Label>
              The brief
              <Textarea
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={briefing}
                required
                minLength={10}
                rows={4}
                placeholder="Describe the setting, style, and what you want to build, or use AI generate brief."
              />
            </Label>
            <Button
              variant="outline"
              type="button"
              disabled={busy || briefing || !name.trim()}
              onClick={generateBrief}
            >
              {briefing && <LoaderCircle className="spin" size={16} />}
              {briefing ? "Writing brief…" : "AI generate brief"}
            </Button>
            <p className="note">
              The generated text fills the field above. Edit and correct it
              before continuing.
            </p>
            <Label className="upload">
              <ImagePlus size={24} />
              <strong>Reference images (optional)</strong>
              <span>Choose up to 6 PNG, JPG or WebP images · 8 MB each</span>
              <Input
                name="images"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(e) =>
                  setFiles(Array.from(e.target.files || []).slice(0, 6))
                }
              />
            </Label>
            {files.length > 0 && (
              <p className="muted">{files.map((f) => f.name).join(" · ")}</p>
            )}
            {error && (
              <Alert variant="destructive" className="error">
                {error}
              </Alert>
            )}
            <Label>
              Triangle budget per asset (optional)
              <Input
                type="number"
                name="triangleBudget"
                min="1"
                max="100000000"
                step="1"
                value={triangleBudget}
                onChange={(e) => setTriangleBudget(e.target.value)}
                placeholder="No limit specified"
              />
            </Label>
            <Button
              variant="default"
              className="wide"
              disabled={busy || briefing}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Plus size={18} />
              )}{" "}
              {busy ? "Creating project…" : "Create project & generate design"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
