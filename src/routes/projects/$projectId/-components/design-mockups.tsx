import { DesignPalette } from "./design-palette";
import { describeError } from "@/lib/error-message";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PictureUploader } from "@/components/picture-uploader";
import { useImageUpload } from "@/hooks/use-image-upload";
import { Check, Download, ImagePlus, LoaderCircle, Send, Trash2, Upload, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AssetImage } from "@/components/asset-image";
import { useLightbox } from "@/components/image-lightbox";
import { Progress, StatusBadge } from "@/components/status";
import { fileUrl, json, request } from "@/lib/client";
import type { DesignMockups, MockupItem } from "@/lib/design-mockups";

const running = (status: string) => ["queued", "running", "cancelling"].includes(status);

/** Concept images beside a chat: generate, revise any mockup, accept the ones that set the direction, upload your own. */
export function DesignMockupStep({
  projectId, version, design, assetType, mockups, items, references, assets = [], onRefresh,
}: {
  projectId: string;
  design: string;
  assetType: string;
  version: number;
  mockups: DesignMockups[];
  items: MockupItem[];
  /** The project's reference images; a mockup is one when its key is listed here. */
  references: string[];
  assets?: { id: string; title?: string | null }[];
  onRefresh: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [baseId, setBaseId] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [count, setCount] = useState(3);
  const [referencing, setReferencing] = useState<MockupItem | null>(null);
  const [note, setNote] = useState("");
  const [referenceTarget, setReferenceTarget] = useState("design");
  const [deleting, setDeleting] = useState<MockupItem | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const uploader = useImageUpload();
  const openLightbox = useLightbox();
  const active = mockups.some((job) => running(job.status));
  const base = items.find((item) => item.id === baseId);
  const isReference = (item: MockupItem) => references.includes(item.key);
  const referenceCount = items.filter(isReference).length;
  const gallery = items.map((item, index) => ({
    src: fileUrl(item.key),
    title: item.source === "uploaded" ? `Uploaded mockup ${items.length - index}` : `Design v${item.designVersion} mockup`,
    caption: isReference(item) ? "Reference image" : "Concept preview from the approved design",
  }));
  useEffect(() => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [mockups.length, mockups[0]?.status, mockups[0]?.images.length]);
  // A deleted base mockup can no longer be revised.
  useEffect(() => {
    if (baseId && !base) setBaseId(null);
  }, [baseId, base]);

  async function act(name: string, action: () => Promise<unknown>, after?: () => void) {
    setBusy(name);
    setError("");
    try {
      await action();
      after?.();
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || active) return;
    void act("generate", () => request(`projects/${projectId}/mockups`, json({
      version, count: base ? Math.min(count, 4) : count, hint, ...(base ? { baseId: base.id } : {}),
    })), () => { setHint(""); setBaseId(null); });
  }
  function upload() {
    const pending = uploader.images.filter((image) => image.file);
    if (!pending.length) return;
    void act("upload", async () => {
      for (const image of pending) {
        const form = new FormData();
        form.set("image", image.file!);
        await request(`projects/${projectId}/mockups/upload`, { method: "POST", body: form });
        uploader.remove(image.id); // a retry after a failure only sends what is left
      }
    }, () => setUploading(false));
  }
  const urlFor = (item: MockupItem, action: string) => `projects/${projectId}/mockups/${item.id}/${action}`;

  return (
    <div className="mockup-studio">
      <section className="design-chat-panel" aria-label="Mockup chat">
        <div className="studio-chat-head">
          <h3>Mockup chat</h3>
          <p className="muted">
            Describe a few examples to generate, or pick a mockup and ask for a change. Paid image requests are recorded in Activity.
          </p>
        </div>
        <div ref={feed} className="studio-chat-feed" aria-label="Mockup history">
          {!mockups.length && <p className="conversation-empty">Generate concept images from the approved design, or upload your own on the right.</p>}
          {[...mockups].reverse().map((job) => {
            const made = items.filter((item) => item.jobId === job.id);
            const jobBase = job.baseId ? items.find((item) => item.id === job.baseId) : undefined;
            return (
              <div className="design-chat-turn" key={job.id}>
                <article className="chat-message is-user">
                  <small>You · design v{job.version}</small>
                  {job.baseId && (
                    <p>{jobBase ? <AssetImage src={fileUrl(jobBase.key)} alt="Mockup being revised" className="mockup-chat-base" style={{ objectFit: "contain" }} /> : "Revise a mockup"}</p>
                  )}
                  <p>{job.hint || (job.baseId ? "Offer a different take." : `Generate ${job.count} mockup${job.count === 1 ? "" : "s"}.`)}</p>
                </article>
                <article className={`chat-message is-agent ${job.status === "failed" ? "is-failed" : running(job.status) ? "is-running" : ""}`}>
                  <div className="chat-agent-head"><strong>{job.images.length} / {job.count} mockups</strong><StatusBadge status={job.status} /></div>
                  {running(job.status) && <Progress value={Math.round(job.images.length / job.count * 100)}
                    label={job.status === "queued" ? "Waiting to generate mockups" : job.status === "cancelling" ? "Stopping mockups" : `Generating mockup ${Math.min(job.images.length + 1, job.count)} of ${job.count}`}
                    status={job.status} />}
                  {job.error && <p>{describeError(job.error)}</p>}
                  {!!made.length && (
                    <div className="mockup-chat-thumbs">
                      {made.map((item) => (
                        <button type="button" key={item.id} aria-label="Inspect mockup"
                          onClick={() => openLightbox(gallery, items.findIndex((entry) => entry.id === item.id))}>
                          <AssetImage src={fileUrl(item.key)} alt="Mockup" style={{ objectFit: "cover" }} />
                        </button>
                      ))}
                    </div>
                  )}
                  {(running(job.status) || job.status === "failed") && (
                    <div className="chat-message-actions">
                      <Button size="sm" variant="outline" disabled={Boolean(busy) || job.status === "cancelling" || (job.status === "failed" && active)}
                        onClick={() => void act(`job-${job.id}`, () => request(`queue/${job.id}/${job.status === "failed" ? "resume" : "cancel"}`, json({})))}>
                        {job.status === "failed" ? "Resume mockups" : job.status === "queued" ? "Cancel mockups" : "Stop mockups"}
                      </Button>
                    </div>
                  )}
                </article>
              </div>
            );
          })}
        </div>
        <form className="studio-chat-compose" onSubmit={generate}>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          {base && (
            <div className="mockup-base-chip">
              <AssetImage src={fileUrl(base.key)} alt="Mockup to revise" style={{ objectFit: "cover" }} />
              <span>Revising this mockup</span>
              <Button type="button" size="icon-xs" variant="ghost" aria-label="Stop revising this mockup" onClick={() => setBaseId(null)}><X /></Button>
            </div>
          )}
          <Label htmlFor="mockup-hint">{base ? "What should change?" : "What should the mockups show? (optional)"}</Label>
          <div className="studio-compose-box">
            <Textarea id="mockup-hint" value={hint} maxLength={12000} disabled={Boolean(busy) || active}
              placeholder={base ? "Make the outlines thinner and the palette warmer…" : "Describe a few examples, or let the design guide the images."}
              onChange={(event) => setHint(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") event.currentTarget.form?.requestSubmit();
              }} />
            <div className="studio-compose-row">
              <Label className="studio-compose-rounds" htmlFor="mockup-count">
                Images
                <Input id="mockup-count" type="number" min={1} max={4} value={count} disabled={Boolean(busy) || active}
                  onChange={(event) => setCount(Math.min(4, Math.max(1, Number(event.target.value) || 1)))} />
              </Label>
              <Button type="submit" className="ml-auto" disabled={Boolean(busy) || active}>
                {busy === "generate" || active ? <LoaderCircle size={15} className="spin" /> : base ? <Wand2 size={15} /> : <Send size={15} />}
                {busy === "generate" ? "Queueing…" : active ? "In progress" : base ? "Revise" : "Generate"}
              </Button>
            </div>
          </div>
          <p className="studio-compose-source">Uses approved design v{version}. Ctrl or ⌘ + Enter sends.</p>
        </form>
      </section>

      <section className="mockup-gallery panel" aria-label="Mockups">
        {assetType === "pixel" && <DesignPalette design={design} version={version} />}
        <div className="section-title flex-wrap gap-3">
          <div>
            <h2>Mockups</h2>
            <p className="muted">
              {referenceCount
                ? `${referenceCount} used as reference. Reference images are sent with every new mockup and batch, and appear on the Design tab where you can add context.`
                : "Mark the mockups that show the direction you want as reference images. They are then sent with every new mockup and batch."}
            </p>
          </div>
          <div>
            <Button variant="outline" disabled={Boolean(busy)} onClick={() => setUploading(true)}>
              <Upload size={15} /> Upload mockup
            </Button>
          </div>
        </div>
        {!items.length ? (
          <div className="empty-note">
            <ImagePlus size={28} strokeWidth={1.2} />
            <p>No mockups yet. They are concept previews, not final assets.</p>
          </div>
        ) : (
          <div className="mockup-grid">
            {items.map((item, index) => (
              <figure key={item.id} className={isReference(item) ? "mockup-card is-accepted" : "mockup-card"}>
                <button type="button" className="mockup-card-image" aria-label={`Inspect mockup ${items.length - index}`}
                  onClick={() => openLightbox(gallery, index)}>
                  <AssetImage src={fileUrl(item.key)} alt={gallery[index].title} className="aspect-[3/2] w-full" style={{ objectFit: "contain" }} />
                </button>
                <figcaption>
                  <div className="mockup-card-meta">
                    <span>{item.source === "uploaded" ? "Uploaded" : `Design v${item.designVersion}`}{item.parentId ? " · revision" : ""}</span>
                    {isReference(item) && <Badge variant="secondary"><Check size={12} /> Reference</Badge>}
                  </div>
                  <div className="mockup-card-actions">
                    <Button size="sm" variant={isReference(item) ? "outline" : "default"} disabled={Boolean(busy)}
                      onClick={() => isReference(item)
                        ? void act(`reference-${item.id}`, () => request(urlFor(item, "reference"), { method: "DELETE" }))
                        : (setNote(""), setReferencing(item))}>
                      <Check size={14} /> {isReference(item) ? "Remove from references" : "Use as reference"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={active || Boolean(busy)}
                      onClick={() => { setBaseId(item.id); document.getElementById("mockup-hint")?.focus(); }}>
                      <Wand2 size={14} /> Revise
                    </Button>
                    <Button asChild size="icon-sm" variant="ghost" aria-label="Download mockup">
                      <a href={fileUrl(item.key)} download><Download size={14} /></a>
                    </Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Delete mockup" disabled={Boolean(busy)} onClick={() => setDeleting(item)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      <Dialog open={uploading} onOpenChange={(open) => { if (busy) return; setUploading(open); if (!open) uploader.reset(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload mockups</DialogTitle>
            <DialogDescription>Add your own concept images. They join the gallery and can be used as references like generated ones.</DialogDescription>
          </DialogHeader>
          <PictureUploader title="Mockup images" images={uploader.images} onFilesAdded={uploader.addFiles}
            onImportFromUrl={uploader.importFromUrl} onRemove={uploader.remove} disabled={Boolean(busy)} isBusy={uploader.isBusy} />
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={Boolean(busy)}>Cancel</Button></DialogClose>
            <Button disabled={Boolean(busy) || uploader.isBusy || !uploader.images.length} onClick={upload}>
              {busy === "upload" ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}
              {busy === "upload" ? "Uploading…" : `Add ${uploader.images.length || ""} mockup${uploader.images.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(referencing)} onOpenChange={(open) => !busy && !open && setReferencing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Use as reference</DialogTitle>
            <DialogDescription>
              Choose the project design or a specific asset. Future versions freeze this image and your context.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="mockup-reference-target">Use for</Label>
            <select id="mockup-reference-target" className="w-full rounded-md border bg-background p-2" value={referenceTarget} onChange={(event) => setReferenceTarget(event.target.value)} disabled={Boolean(busy)}>
              <option value="design">Project design</option>
              {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.title || "Untitled asset"}</option>)}
            </select>
          </div>
          {referencing && <AssetImage src={fileUrl(referencing.key)} alt="Mockup being used as a reference" className="w-full rounded-lg bg-muted" style={{ objectFit: "contain", maxHeight: 260 }} />}
          <div className="space-y-2">
            <Label htmlFor="mockup-note">Context (optional)</Label>
            <Textarea id="mockup-note" value={note} maxLength={1000} rows={4}
              placeholder="I like the thin outlines and the warm background, but keep the icons less detailed."
              onChange={(event) => setNote(event.target.value)} />
          </div>
          {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={Boolean(busy)}>Cancel</Button></DialogClose>
            <Button disabled={Boolean(busy)}
              onClick={() => referencing && void act(`reference-${referencing.id}`, () => request(referenceTarget === "design" ? urlFor(referencing, "reference") : `projects/${projectId}/assets/${referenceTarget}/mockups/${referencing.id}`, json({ note })), () => setReferencing(null))}>
              <Check size={16} /> {busy.startsWith("reference-") ? "Saving…" : "Use as reference"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !busy && !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this mockup?</DialogTitle>
            <DialogDescription>
              It leaves the gallery and the visual direction. Batches already started keep what they were given.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={Boolean(busy)}>Cancel</Button></DialogClose>
            <Button variant="destructive" disabled={Boolean(busy)}
              onClick={() => deleting && void act(`delete-${deleting.id}`, () => request(`projects/${projectId}/mockups/${deleting.id}`, { method: "DELETE" }), () => setDeleting(null))}>
              <Trash2 size={16} /> {busy.startsWith("delete-") ? "Deleting…" : "Delete mockup"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
