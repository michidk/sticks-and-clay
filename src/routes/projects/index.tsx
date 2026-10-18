import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CardsSkeleton } from "@/components/loading";
import { PictureUploader } from "@/components/picture-uploader";
import { useImageUpload } from "@/hooks/use-image-upload";
import { appendReferenceImages } from "@/lib/image-file";
import { AssetImage } from "@/components/asset-image";
import { WorkerNotice } from "@/components/worker-notice";
import { ProjectActionsMenu } from "@/components/project-actions-menu";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plus, Layers, LoaderCircle, Image as ImageIcon } from "lucide-react";
import { projectState } from "@/lib/project-summary";
import { assetTypeHints, assetTypeLabels, assetTypes, type AssetType } from "@/lib/asset-types";
import { request, costSummary, fileUrl } from "../../lib/client";
import { Progress, StatusBadge } from "../../components/status";
export const Route = createFileRoute("/projects/")({ component: ProjectsPage });
function ProjectsPage() {
  const uploader = useImageUpload();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loadError, setLoadError] = useState("");
  const [workerHealthy, setWorkerHealthy] = useState(true);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const [projects, setProjects] = useState<any[]>([]),
    [loading, setLoading] = useState(true),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [assetType, setAssetType] = useState<AssetType>("model"),
    [draftId, setDraftId] = useState<string | null>(null),
    [naming, setNaming] = useState(false),
    [briefing, setBriefing] = useState(false);
  const dialogBusy = busy || naming || briefing || uploader.isBusy;
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
      appendReferenceImages(form, uploader.images);
      const result = await request("projects/name", {
        method: "POST",
        body: form,
      });
      setDraftId(result.id);
      uploader.reset(result.references);
      setName(result.name);
    } catch (e) {
      if ((e as any).data?.draftId) {
        setDraftId((e as any).data.draftId);
        if ((e as any).data.references)
          uploader.reset((e as any).data.references);
      }
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
  const mounted = useRef(true);
  const load = () =>
    request("projects")
      .then((d) => {
        if (mounted.current) {
          setProjects(d.projects);
          setWorkerHealthy(d.workerHealthy ?? true);
          setLoadError("");
          setLoading(false);
        }
      })
      .catch((e) => {
        if (mounted.current) {
          setLoadError(e.message);
          setLoading(false);
        }
      });
  useEffect(() => {
    mounted.current = true;
    void load();
    const t = setInterval(load, 3000);
    return () => {
      mounted.current = false;
      clearInterval(t);
    };
  }, []);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (dialogBusy) return;
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
  const liveProjects = projects.filter((p) => !p.archivedAt);
  const visibleProjects = projects
    .filter(
      (p) =>
        (p.name + " " + p.description)
          .toLowerCase()
          .includes(query.trim().toLowerCase()) &&
        (statusFilter === "archived"
          ? Boolean(p.archivedAt)
          : !p.archivedAt) &&
        (statusFilter === "all" || statusFilter === "archived" ||
          (statusFilter === "active"
            ? p.collection?.active + p.collection?.queued > 0 ||
              p.designUpdating ||
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
    <main className="projects-page">
      <section className="page-header">
        <div>
          <h1>
            Projects
            {!loading && (
              <Badge variant="secondary" className="count">
                {liveProjects.length}
              </Badge>
            )}
          </h1>
          {!loading && !projects.length && (
            <p className="lede">
              A project turns a name, brief and reference images into a design
              reference, then generates 3D models or graphics that follow it.
            </p>
          )}
        </div>
        <Button variant="default" onClick={newProject}>
          <Plus size={18} />
          New project
        </Button>
      </section>
      {!!projects.length && (
        <div className="project-list-tools">
          <Input
            aria-label="Search projects"
            placeholder="Search projects"
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
                <SelectItem value="archived">Archived</SelectItem>
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
      {loadError && !creating && (
        <Alert variant="destructive" role="alert" className="error">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      {!workerHealthy &&
        projects.some(
          (p) =>
            (p.collection?.active || 0) + (p.collection?.queued || 0) > 0 ||
            p.designUpdating ||
            ["queued", "designing"].includes(p.status),
        ) && <WorkerNotice />}
      {loading ? (
        <CardsSkeleton />
      ) : (
        <div className="project-grid">
          {visibleProjects.map((p) => {
            const state = p.designUpdating
              ? { label: "Updating design", tone: "running" }
              : projectState(
                  p.status,
                  p.collection || {
                    total: 0,
                    active: 0,
                    queued: 0,
                    completed: 0,
                    attention: 0,
                  },
                );
            const cover = p.thumbnail || p.references[0];
            return (
              <Card key={p.id} className="project-card">
                <Link
                  className="project-card-link"
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
                    {cover ? (
                      <AssetImage
                        src={fileUrl(cover)}
                        alt={`${p.name} ${p.thumbnail ? "collection render" : "reference image"}`}
                        style={
                          p.thumbnail || p.assetType !== "model"
                            ? { objectFit: "contain", padding: p.thumbnail ? 0 : 14 }
                            : undefined
                        }
                      />
                    ) : (
                      <div className="abstract">
                        <Layers size={48} strokeWidth={0.9} />
                      </div>
                    )}
                    <StatusBadge tone={state.tone as any}>
                      {state.label}
                    </StatusBadge>
                    <Badge
                      variant="secondary"
                      className="badge asset-type-badge"
                    >
                      {p.assetType !== "model" ? (
                        <ImageIcon size={12} />
                      ) : (
                        <Layers size={12} />
                      )}
                      {assetTypeLabels[p.assetType as AssetType]}
                    </Badge>
                  </div>
                  <div className="project-body">
                    <h3>{p.name}</h3>
                    <div className="project-card-brief">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        allowedElements={["p", "strong", "em", "del"]}
                        unwrapDisallowed
                      >
                        {p.description || "*No brief yet.*"}
                      </ReactMarkdown>
                    </div>
                    {["queued", "designing"].includes(p.status) && (
                      <Progress
                        value={p.progress}
                        label={p.phase}
                        status={p.status}
                      />
                    )}
                    <div className="project-card-status">
                      <span>
                        {p.collection?.total || 0}{" "}
                        {p.assetType !== "model"
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
                        {cover && ` · ${p.thumbnail ? "Collection render" : "Reference image"}`}
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
                <ProjectActionsMenu
                  className="project-card-menu"
                  project={p}
                  canDelete={!p.collection?.total && !p.designUpdating}
                  onChanged={load}
                  onDeleted={load}
                />
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
            <strong>New project</strong>
            <span>Name it, then add a brief or reference images.</span>
          </Button>
        </div>
      )}
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!open && !dialogBusy) {
            setCreating(false);
            uploader.reset();
          }
        }}
      >
        <DialogContent
          className="setup-dialog"
          showCloseButton={!dialogBusy}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            dialogOpener.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Your brief becomes the first design reference as written. Review
              and approve it, then improve it with AI or generate mockups
              before anything else is generated.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={create} className="setup-form">
            <div className="setup-fields">
              <input type="hidden" name="assetType" value={assetType} />
              <fieldset
                className="asset-type-choice"
                disabled={busy || naming || briefing || Boolean(draftId)}
              >
                <legend>Asset type</legend>
                <div>
                  {assetTypes.map((type) => (
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
                          {assetTypeLabels[type]}
                        </strong>
                        <small>{assetTypeHints[type]}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-2">
                <Label htmlFor="project-name">Name</Label>
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
                    placeholder="Stonehaven village"
                  />
                  <Button
                    variant="outline"
                    type="button"
                    className="shrink-0"
                    disabled={
                      dialogBusy ||
                      (!description.trim() && !uploader.images.length)
                    }
                    onClick={generateName}
                    title="Suggest a name from the brief or references (paid AI request)"
                  >
                    {naming && <LoaderCircle className="spin" size={16} />}
                    Suggest name
                  </Button>
                </div>
              </div>
              <div className="brief-field">
                <Label htmlFor="project-brief">Brief (optional)</Label>
                <MarkdownTextarea
                  id="project-brief"
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={naming || briefing}
                  maxLength={12000}
                  rows={4}
                  placeholder="Direction, materials, mood. Leave empty to work from the name and references."
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
                  dialogBusy ||
                  !(name.trim() || description.trim() || uploader.images.length)
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
                {name.trim() || description.trim() || uploader.images.length
                  ? `Paid request using ${[
                      name.trim() && "the name",
                      uploader.images.length &&
                        `${uploader.images.length} reference image${uploader.images.length === 1 ? "" : "s"}`,
                      description.trim() && "your notes",
                    ]
                      .filter(Boolean)
                      .join(", ")}. Edit the result before creating the project.`
                  : "Add a name, notes or reference images to draft a brief or suggest a name with AI."}
              </p>
              {error && (
                <Alert variant="destructive" className="error">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
            <DialogFooter className="setup-footer">
              <DialogClose asChild>
                <Button variant="outline" type="button" disabled={dialogBusy}>
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="default" disabled={dialogBusy}>
                {busy && <LoaderCircle className="spin" size={18} />}
                {busy ? "Creating project…" : "Create project"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
