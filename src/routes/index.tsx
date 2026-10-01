import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Plus,
  ArrowUpRight,
  Layers,
  LoaderCircle,
  Image as ImageIcon,
} from "lucide-react";
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
    [assetType, setAssetType] = useState<"model" | "graphic">("model"),
    [draftId, setDraftId] = useState<string | null>(null),
    [briefing, setBriefing] = useState(false);
  function newProject(event: React.MouseEvent<HTMLElement>) {
    dialogOpener.current = event.currentTarget;
    setName("");
    setDescription("");
    setAssetType("model");
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
      form.set("assetType", assetType);
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
            Build a vision.
            <br />
            <em>Shape every detail.</em>
          </h1>
          <p className="lede">
            Turn references into a shared visual language.
            <br />
            Generate cohesive 3D assets and graphics with your agents.
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
                        setAssetType(p.assetType || "model");
                        setDraftId(p.id);
                        uploader.reset(p.references);
                        setCreating(true);
                      }
                    : undefined
                }
              >
                <div
                  className="project-cover"
                  style={{ aspectRatio: "16 / 9", height: "auto" }}
                >
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
                  <Badge
                    variant="secondary"
                    className="badge asset-type-badge"
                  >
                    {p.assetType === "graphic" ? (
                      <ImageIcon size={12} />
                    ) : (
                      <Layers size={12} />
                    )}
                    {p.assetType === "graphic" ? "Graphics" : "3D assets"}
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
            <strong>A new collection starts here</strong>
            <span>
              Name your project, then optionally add a brief or references.
            </span>
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
              Give your collection a direction.
            </DialogTitle>
            <DialogDescription className="muted">
              Start with a name. Add an optional brief or reference images
              to guide your design.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={create}>
            <input type="hidden" name="assetType" value={assetType} />
            <Label>
              What are you creating?
              <Select
                value={assetType}
                onValueChange={(value) =>
                  setAssetType(value as "model" | "graphic")
                }
                disabled={briefing || Boolean(draftId)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="model">3D assets</SelectItem>
                  <SelectItem value="graphic">Graphics</SelectItem>
                </SelectContent>
              </Select>
            </Label>
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
              The brief (optional)
              <Textarea
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={briefing}
                maxLength={12000}
                rows={4}
                placeholder="Add any direction you have, or leave this empty to use the project name and references."
              />
            </Label>
            <Button
              variant="outline"
              type="button"
              disabled={busy || briefing || uploader.isBusy || !name.trim()}
              onClick={generateBrief}
            >
              {briefing && <LoaderCircle className="spin" size={16} />}
              {briefing
                ? description.trim()
                  ? "Enhancing brief…"
                  : "Writing brief…"
                : description.trim()
                  ? "Enhance with AI"
                  : "Generate with AI"}
            </Button>
            <p className="note">
              {description.trim()
                ? "AI will refine your notes using the project name and references. Review the result before continuing."
                : "AI will draft a brief from the project name and references. You can edit it before continuing."}
            </p>
            <PictureUploader
              images={uploader.images}
              onFilesAdded={uploader.addFiles}
              onImportFromUrl={uploader.importFromUrl}
              onRemove={uploader.remove}
              disabled={busy || briefing}
              isBusy={uploader.isBusy}
            />
            <Button
              variant="outline"
              type="button"
              className="w-full whitespace-normal h-auto min-h-9"
              disabled={
                busy || briefing || uploader.isBusy || !name.trim() ||
                !uploader.images.length
              }
              onClick={generateBrief}
            >
              {briefing && <LoaderCircle className="spin shrink-0" size={16} />}
              {briefing ? "Writing brief…" : "Generate brief from reference images"}
            </Button>
            <p className="note">
              Add reference images and a project name to draft an editable brief.
              Any notes above will be included.
            </p>
            {error && (
              <Alert variant="destructive" className="error">
                {error}
              </Alert>
            )}
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
