import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MarkdownTextarea } from "@/components/markdown-textarea";
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
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Plus,
  ArrowUpRight,
  Layers,
  LoaderCircle,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import { projectState } from "@/lib/project-summary";
import { request, costSummary, fileUrl } from "../lib/client";
import { Progress } from "../components/progress";
import { agentStateFromStatus } from "../components/agent-state";
export const Route = createFileRoute("/")({ component: ProjectsPage });
function ProjectsPage() {
  const uploader = useImageUpload();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [statusFilter, setStatusFilter] = useState("all");
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
    [naming, setNaming] = useState(false),
    [briefing, setBriefing] = useState(false);
  function newProject(event: React.MouseEvent<HTMLElement>) {
    dialogOpener.current = event.currentTarget;
    setError("");
    setName("");
    setDescription("");
    setAssetType("model");
    setDraftId(null);
    uploader.reset();
    setCreating(true);
  }
  async function generateName() {
    setNaming(true);
    setError("");
    try {
      const form = new FormData();
      form.set("description", description);
      form.set("assetType", assetType);
      if (draftId) form.set("draftId", draftId);
      const result = await request("projects/name", {
        method: "POST",
        body: form,
      });
      setDraftId(result.id);
      setName(result.name);
    } catch (e) {
      if ((e as any).data?.draftId) setDraftId((e as any).data.draftId);
      setError((e as Error).message);
    } finally {
      setNaming(false);
    }
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
    if (busy || naming || briefing || uploader.isBusy) return;
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
  const visibleProjects = projects
    .filter(
      (p) =>
        (p.name + " " + p.description)
          .toLowerCase()
          .includes(query.trim().toLowerCase()) &&
        (statusFilter === "all" ||
          (statusFilter === "active"
            ? p.collection?.active + p.collection?.queued > 0 ||
              ["queued", "designing"].includes(p.status)
            : p.collection?.attention > 0 ||
              ["failed", "review"].includes(p.status))),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : +new Date(b.createdAt) - +new Date(a.createdAt),
    );
  return (
    <main
      className={
        projects.length ? "projects-page has-projects" : "projects-page"
      }
    >
      <div className="eyebrow">YOUR CREATIVE WORKSPACE</div>
      <section className="page-heading">
        <div>
          <h1>
            Build a vision.
            <br />
            <em>Shape every detail.</em>
          </h1>
          <p className="lede">
            Turn references into a shared visual language. <br />
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
        <span>
          {projects.length
            ? "Your collections, at a glance."
            : "Every collection starts with a direction."}
        </span>
      </div>
      {!!projects.length && (
        <div className="project-list-tools">
          <Input
            aria-label="Search projects"
            placeholder="Find a project…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Label>
            Show
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Filter projects">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                <SelectItem value="active">In progress</SelectItem>
                <SelectItem value="attention">Needs attention</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          <Label>
            Sort
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger aria-label="Sort projects">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">Newest first</SelectItem>
                <SelectItem value="name">Name A–Z</SelectItem>
              </SelectContent>
            </Select>
          </Label>
        </div>
      )}
      {error && !creating && (
        <Alert variant="destructive" role="alert" className="error">
          {error}
        </Alert>
      )}
      {loading ? (
        <CardsSkeleton />
      ) : (
        <div className="project-grid">
          {visibleProjects.map((p) => {
            const state = projectState(
              p.status,
              p.collection || {
                total: 0,
                active: 0,
                queued: 0,
                completed: 0,
                attention: 0,
              },
            );
            return (
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
                        style={
                          p.thumbnail ? { objectFit: "contain" } : undefined
                        }
                      />
                    ) : (
                      <div className="abstract">
                        <Layers size={68} strokeWidth={0.8} />
                        <span>STYLE STARTS HERE</span>
                      </div>
                    )}
                    <Badge
                      variant="secondary"
                      className={"badge " + state.tone}
                    >
                      {state.label}
                    </Badge>
                    {(p.thumbnail || p.references[0]) && (
                      <span className="cover-provenance">
                        {p.thumbnail
                          ? "Generated collection"
                          : "Reference image"}
                      </span>
                    )}
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
                    <div className="project-card-brief">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        allowedElements={["p", "strong", "em", "del"]}
                        unwrapDisallowed
                      >
                        {p.description ||
                          "A collection inspired by its name and references."}
                      </ReactMarkdown>
                    </div>
                    {["queued", "designing"].includes(p.status) && (
                      <Progress
                        value={p.progress}
                        label={p.phase}
                        agentState={agentStateFromStatus(p.status)}
                      />
                    )}
                    <div className="project-card-status">
                      <span>
                        {p.collection?.total || 0}{" "}
                        {p.assetType === "graphic"
                          ? p.collection?.total === 1
                            ? "graphic"
                            : "graphics"
                          : p.collection?.total === 1
                            ? "model"
                            : "models"}{" "}
                        · {p.collection?.completed || 0} completed
                      </span>
                      {!!p.collection?.attention && (
                        <span>{p.collection.attention} need attention</span>
                      )}
                      {p.status === "ready" && <span>Design approved</span>}
                    </div>
                    <div className="card-meta">
                      <span>
                        {new Date(p.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span>
                        Est. {costSummary(p.usage.cost)}
                        {p.usage.unpriced > 0 && (
                          <span> · {p.usage.unpriced} not yet priced</span>
                        )}
                      </span>
                    </div>
                  </div>
                </Link>
              </Card>
            );
          })}
          {!visibleProjects.length && !!projects.length && (
            <div className="collection-no-results">
              <h3>No matching projects</h3>
              <p>Try another search or filter.</p>
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                }}
              >
                Show all projects
              </Button>
            </div>
          )}
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
          if (!open && !busy && !naming && !briefing && !uploader.isBusy) {
            setCreating(false);
            uploader.reset();
          }
        }}
      >
        <DialogContent
          className="setup-dialog"
          showCloseButton={!busy && !naming && !briefing && !uploader.isBusy}
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
              Start with a name. Add an optional brief or reference images to
              guide your design.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="setup-form">
            <div className="setup-fields">
              <input type="hidden" name="assetType" value={assetType} />
              <fieldset
                className="asset-type-choice"
                disabled={busy || naming || briefing || Boolean(draftId)}
              >
                <legend>What are you creating?</legend>
                <div>
                  {(["model", "graphic"] as const).map((type) => (
                    <label key={type}>
                      <input
                        type="radio"
                        name="assetTypeChoice"
                        value={type}
                        checked={assetType === type}
                        onChange={() => setAssetType(type)}
                      />
                      {type === "model" ? (
                        <Layers size={20} />
                      ) : (
                        <ImageIcon size={20} />
                      )}
                      <span>
                        <strong>
                          {type === "model" ? "3D assets" : "Graphics"}
                        </strong>
                        <small>
                          {type === "model"
                            ? "Models & Blender source"
                            : "Images & illustrations"}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-2">
                <Label htmlFor="project-name">Project name</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="project-name"
                    className="min-w-0 flex-1"
                    name="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={naming || briefing}
                    required
                    maxLength={100}
                    placeholder="e.g. Stonehaven village"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    className="shrink-0 max-sm:!size-11"
                    disabled={
                      busy ||
                      naming ||
                      briefing ||
                      uploader.isBusy ||
                      !description.trim()
                    }
                    onClick={generateName}
                    aria-label="Generate project name from brief"
                    title="Generate project name from brief"
                  >
                    {naming ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Sparkles size={16} />
                    )}
                  </Button>
                </div>
              </div>
              <div className="brief-field">
                <Label htmlFor="project-brief">The brief (optional)</Label>
                <MarkdownTextarea
                  id="project-brief"
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={naming || briefing}
                  maxLength={12000}
                  rows={4}
                  placeholder="Add any direction you have, or leave this empty to use the project name and references."
                />
              </div>
              <PictureUploader
                images={uploader.images}
                onFilesAdded={uploader.addFiles}
                onImportFromUrl={uploader.importFromUrl}
                onRemove={uploader.remove}
                disabled={busy || naming || briefing}
                isBusy={uploader.isBusy}
              />
              <Button
                variant="outline"
                type="button"
                className="w-full whitespace-normal h-auto min-h-9"
                disabled={
                  busy || naming || briefing || uploader.isBusy || !name.trim()
                }
                onClick={generateBrief}
              >
                {briefing && (
                  <LoaderCircle className="spin shrink-0" size={16} />
                )}
                {briefing
                  ? "Writing brief…"
                  : description.trim()
                    ? "Refine brief with AI"
                    : "Draft brief with AI"}
              </Button>
              <p className="note">
                {name.trim()
                  ? `Uses your name${uploader.images.length ? `, ${uploader.images.length} reference image${uploader.images.length === 1 ? "" : "s"}` : ""} and any notes. Review and edit the result before continuing.`
                  : "Enter a project name to draft a brief. References and notes are optional."}
              </p>
              {error && (
                <Alert variant="destructive" className="error">
                  {error}
                </Alert>
              )}
            </div>
            <div className="setup-footer">
              <Button
                variant="default"
                className="wide"
                disabled={busy || naming || briefing || uploader.isBusy}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Plus size={18} />
                )}{" "}
                {busy
                  ? "Creating project…"
                  : "Create project & generate design"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
