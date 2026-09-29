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
import { PictureUploader } from "@/components/picture-uploader";
import { useImageUpload } from "@/hooks/use-image-upload";
import { appendReferenceImages } from "@/lib/image-file";
import { AssetImage } from "@/components/asset-image";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Plus, ArrowUpRight, Layers, LoaderCircle } from "lucide-react";
import { request, money, fileUrl } from "../lib/client";
import { Progress } from "../components/progress";
export const Route = createFileRoute("/")({ component: ProjectsPage });
function ProjectsPage() {
  const uploader = useImageUpload();
  const dialogOpener = useRef<HTMLElement | null>(null);
  const [projects, setProjects] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [triangleBudget, setTriangleBudget] = useState(""),
    [draftId, setDraftId] = useState<string | null>(null),
    [briefing, setBriefing] = useState(false);
  function newProject(event: React.MouseEvent<HTMLElement>) {
    dialogOpener.current = event.currentTarget;
    setName("");
    setDescription("");
    setTriangleBudget("");
    setDraftId(null);
    uploader.reset();
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
      appendReferenceImages(form, uploader.images);
      const result = await request("projects/brief", {
        method: "POST",
        body: form,
      });
      setDraftId(result.id);
      uploader.reset(result.references);
      setDescription(result.brief);
    } catch (e) {
      if ((e as any).data?.draftId) {
        setDraftId((e as any).data.draftId);
        if ((e as any).data.references)
          uploader.reset((e as any).data.references);
      }
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
    if (busy || briefing || uploader.isBusy) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget);
      if (draftId) form.set("draftId", draftId);
      form.delete("images");
      appendReferenceImages(form, uploader.images);
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
                        dialogOpener.current = e.currentTarget;
                        e.preventDefault();
                        setName(p.name);
                        setDescription(p.description);
                        setTriangleBudget(p.triangleBudget?.toString() || "");
                        setDraftId(p.id);
                        uploader.reset(p.references);
                        setCreating(true);
                      }
                    : undefined
                }
              >
                <div className="project-cover">
                  {p.thumbnail || p.references[0] ? (
                    <AssetImage
                      src={fileUrl(p.thumbnail || p.references[0])}
                      alt={`${p.name} ${p.thumbnail ? "asset collection" : "reference"}`}
                      style={p.thumbnail ? { objectFit: "contain" } : undefined}
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
          if (!open && !busy && !briefing && !uploader.isBusy) {
            setCreating(false);
            uploader.reset();
          }
        }}
      >
        <DialogContent
          showCloseButton={!busy && !briefing && !uploader.isBusy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            dialogOpener.current?.focus();
          }}
        >
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
              disabled={busy || briefing || uploader.isBusy || !name.trim()}
              onClick={generateBrief}
            >
              {briefing && <LoaderCircle className="spin" size={16} />}
              {briefing ? "Writing brief…" : "AI generate brief"}
            </Button>
            <p className="note">
              The generated text fills the field above. Edit and correct it
              before continuing.
            </p>
            <PictureUploader
              images={uploader.images}
              fileInputRef={uploader.fileInputRef}
              onFilesAdded={uploader.addFiles}
              onImportFromUrl={uploader.importFromUrl}
              onRemove={uploader.remove}
              disabled={busy || briefing}
              isBusy={uploader.isBusy}
            />
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
              disabled={busy || briefing || uploader.isBusy}
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
