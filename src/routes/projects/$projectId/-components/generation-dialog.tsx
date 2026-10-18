import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoaderCircle, Play } from "lucide-react";
import { PictureUploader } from "@/components/picture-uploader";
import { useImageUpload } from "@/hooks/use-image-upload";
import { appendReferenceImages } from "@/lib/image-file";
import { request, json } from "@/lib/client";
import type { AssetDraft } from "./asset-drafts";
import type { RuntimeSettings } from "@/lib/contracts";
import type { AssetType } from "@/lib/asset-types";
import type { StartingPoint } from "@/lib/starting-point";
import { StartingPointField } from "./starting-point-field";

type GenerationDialogProps = {
  assetType?: AssetType;
  idea?: AssetDraft;
  projectId: string;
  designVersion: number;
  ready: boolean;
  isGraphics: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<unknown>;
  onSaved: (started: boolean) => Promise<void>;
};

export function GenerationDialog({
  assetType,
  idea,
  projectId,
  designVersion,
  ready,
  isGraphics,
  open,
  onOpenChange,
  onRefresh,
  onSaved,
}: GenerationDialogProps) {
  const [busy, setBusy] = useState<false | "save" | "start">(false);
  const type = assetType ?? (isGraphics ? "graphic" : "model");
  const [startingPoint, setStartingPoint] = useState(idea?.input.startingPoint);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceRun, setSourceRun] = useState("");
  const [sourceRemoved, setSourceRemoved] = useState(false);
  const [sourceUnits, setSourceUnits] = useState<StartingPoint["units"]>(idea?.input.startingPoint?.units ?? "mm");
  const [sourceVersions, setSourceVersions] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let active = true;
    void request<{ sources: { id: string; label: string }[] }>(`projects/${projectId}/starting-points`).then((result) => { if (active) setSourceVersions(result.sources); }).catch(() => {});
    return () => { active = false; };
  }, [projectId]);
  const [error, setError] = useState("");
  const [modelBrief, setModelBrief] = useState(idea?.input.prompt || "");
  const [parts, setParts] = useState(idea?.input.parts ?? []);
  const uploader = useImageUpload();
  const [referenceNotes, setReferenceNotes] = useState(idea?.referenceNotes ?? {});
  const [savedAssetId, setSavedAssetId] = useState(idea?.id);
  const [expectedReferences, setExpectedReferences] = useState({ references: idea?.references ?? [], referenceNotes: idea?.referenceNotes ?? {} });
  const [skipVisualMock, setSkipVisualMock] = useState(idea?.input.visualTargetMode === "skip");
  const [spriteEnabled, setSpriteEnabled] = useState(Boolean(idea?.input.spriteTarget));
  const [judgeIterations, setJudgeIterations] = useState(idea?.input.judgeIterations ?? 2);
  const [imageSize, setImageSize] =
    useState<RuntimeSettings["generationDefaults"]["imageSize"]>(idea?.input.imageSize ?? "1024x1024");
  const [briefing, setBriefing] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const assetPlural = "asset";
  useEffect(() => {
    setModelBrief(idea?.input.prompt || "");
    setStartingPoint(idea?.input.startingPoint); setSourceFile(null); setSourceRun(""); setSourceRemoved(false);
    setSourceUnits(idea?.input.startingPoint?.units ?? "mm");
    setSpriteEnabled(Boolean(idea?.input.spriteTarget));
    setSkipVisualMock(idea?.input.visualTargetMode === "skip");
    setParts(idea?.input.parts ?? []);
    uploader.reset(idea?.references ?? []);
    setReferenceNotes(idea?.referenceNotes ?? {});
    setSavedAssetId(idea?.id);
    setExpectedReferences({ references: idea?.references ?? [], referenceNotes: idea?.referenceNotes ?? {} });
  }, [projectId, idea]);
  useEffect(() => {
    if (idea) return;
    let active = true;
    void request<{ settings: RuntimeSettings }>("settings")
      .then(({ settings }) => {
        if (!active) return;
        setJudgeIterations(settings.generationDefaults.judgeIterations);
        setImageSize(settings.generationDefaults.imageSize);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [idea]);
  async function generateBrief() {
    setBriefing(true);
    setError("");
    try {
      const result = await request<{ brief: string }>(
        `projects/${projectId}/model-brief`,
        json({ count: 1, hint: modelBrief }),
      );
      setModelBrief(result.brief);
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBriefing(false);
    }
  }
  async function saveIdea(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const start =
      !idea &&
      ready &&
      (e.nativeEvent as SubmitEvent).submitter?.getAttribute("name") === "start";
    if (!modelBrief.trim()) return setError("Write a brief for this asset, or draft one with AI.");
    setBusy(start ? "start" : "save");
    setError("");
    try {
      const f = new FormData(e.currentTarget);
      const saved = await request<{ id?: string }>(
        `projects/${projectId}/assets${savedAssetId ? `/${savedAssetId}` : ""}`,
        json({
          prompt: f.get("prompt"),
          startingPoint,
          title: f.get("title"),
          visualTargetMode: skipVisualMock ? "skip" : "review",
          spriteTarget:
            f.get("spriteTarget") === "on"
              ? {
                  ...idea?.input.spriteTarget,
                  size: Number(f.get("spriteSize")),
                  directions: idea?.input.spriteTarget?.directions ?? 8,
                  frameCount: Number(f.get("spriteFrames")),
                  pixel: idea?.input.spriteTarget?.pixel ?? true,
                  loop: idea?.input.spriteTarget?.loop ?? true,
                }
              : undefined,
          count: 1,
          parts: parts.length ? parts : undefined,
          judgeIterations: Number(f.get("iterations")),
          imageSize: isGraphics && type !== "cad" ? f.get("imageSize") : "1024x1024",
        }, savedAssetId ? "PUT" : "POST"),
      );
      const assetId = saved.id ?? savedAssetId;
      if (!assetId) throw new Error("Asset save returned no identifier");
      setSavedAssetId(assetId);
      const references = new FormData();
      appendReferenceImages(references, uploader.images);
      references.set("referenceNotes", JSON.stringify(referenceNotes));
      references.set("expected", JSON.stringify(expectedReferences));
      const updatedReferences = await request<{ references: string[]; referenceNotes: Record<string, string> }>(`projects/${projectId}/assets/${assetId}/references`, { method: "POST", body: references });
      setExpectedReferences(updatedReferences);
      uploader.reset(updatedReferences.references);
      setReferenceNotes(updatedReferences.referenceNotes);
      if (sourceFile || sourceRun || sourceRemoved) {
        const source = new FormData(); source.set("expected", startingPoint?.sha256 ?? ""); source.set("units", sourceUnits);
        if (sourceFile) source.set("file", sourceFile);
        if (sourceRun) source.set("sourceRunId", sourceRun);
        const updated = await request<{ startingPoint: StartingPoint | null }>(`projects/${projectId}/assets/${assetId}/starting-point`, { method: "POST", body: source });
        setStartingPoint(updated.startingPoint ?? undefined); setSourceFile(null); setSourceRun(""); setSourceRemoved(false);
      }
      if (start) await request(`projects/${projectId}/assets/${assetId}/generate`, json({}));
      setModelBrief("");
      onOpenChange(false);
      await onSaved(start);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = Boolean(busy) || briefing || uploader.isBusy;
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !locked) onOpenChange(false);
      }}
    >
      <DialogContent
        className="setup-dialog idea-dialog"
        showCloseButton={!locked}
        onOpenAutoFocus={(event) => {
          opener.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          event.preventDefault();
          document.getElementById("model-brief")?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{idea ? "Edit asset" : "Add asset"}</DialogTitle>
          <DialogDescription>
            {idea
              ? "Changes apply to future versions of this asset."
              : ready
                ? `Start generation now, or save the asset in Ideas and start it later. Generation uses design v${designVersion}.`
                : "Assets wait in Ideas until the design is approved."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={saveIdea} className="setup-form">
          <div className="setup-fields">
            <StartingPointField type={type} source={startingPoint} file={sourceFile} run={sourceRun} removed={sourceRemoved} units={sourceUnits} disabled={locked} versions={sourceVersions}
              onFile={(file) => { setSourceFile(file); setSourceRun(""); setSourceRemoved(false); }} onRun={(run) => { setSourceRun(run); setSourceFile(null); setSourceRemoved(false); }}
              onUnits={setSourceUnits} onRemove={() => { setSourceRemoved(true); setSourceFile(null); setSourceRun(""); }} />
            <div className="brief-field">
              <div className="field-heading flex-wrap">
                <Label htmlFor="model-brief">Brief</Label>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={
                    locked ||
                    !ready
                  }
                  onClick={() => generateBrief()}
                >
                  {briefing && <LoaderCircle className="spin" size={16} />}
                  {briefing ? "Writing brief…" : "Draft brief with AI"}
                </Button>
              </div>
              <MarkdownTextarea
                id="model-brief"
                name="prompt"
                value={modelBrief}
                onChange={(e) => setModelBrief(e.target.value)}
                disabled={locked}
                maxLength={12000}
                rows={5}
                placeholder={`Describe the ${assetPlural} you want.`}
              />
              <p
                className="m-0 text-xs text-muted-foreground"
                role={briefing ? "status" : undefined}
              >
                {briefing
                  ? "Writing a brief from the approved design…"
                  : "Drafting with AI is a paid request recorded in Activity."}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="idea-title">Title</Label>
              <Input
                id="idea-title"
                name="title"
                maxLength={100}
                defaultValue={idea?.title ?? ""}
                disabled={locked}
                placeholder="AI writes it from the brief"
              />
              <p className="m-0 text-xs text-muted-foreground">
                Leave empty and AI writes a short title from the brief, a small paid request recorded in Activity.
              </p>
            </div>
            <fieldset disabled={locked} className="space-y-3">
              <legend>Parts (optional)</legend>
              <p className="muted">Named parts are generated together as one asset version.</p>
              {parts.map((part, index) => <div key={index} className="space-y-2 rounded border p-3">
                <Label htmlFor={`part-name-${index}`}>Part name</Label>
                <Input id={`part-name-${index}`} value={part.name} maxLength={80} required onChange={(event) => setParts(parts.map((value, position) => position === index ? { ...value, name: event.target.value } : value))} />
                <Label htmlFor={`part-brief-${index}`}>Part brief</Label>
                <Input id={`part-brief-${index}`} value={part.brief} maxLength={2000} required onChange={(event) => setParts(parts.map((value, position) => position === index ? { ...value, brief: event.target.value } : value))} />
                <Button type="button" variant="ghost" onClick={() => setParts(parts.filter((_, position) => position !== index))}>Remove part</Button>
              </div>)}
              <Button type="button" variant="outline" disabled={parts.length >= 8} onClick={() => setParts([...parts, { name: "", brief: "" }])}>Add part</Button>
            </fieldset>
            <PictureUploader title="Asset references" images={uploader.images} onFilesAdded={uploader.addFiles}
              onImportFromUrl={uploader.importFromUrl} onRemove={uploader.remove} disabled={locked} isBusy={uploader.isBusy}
              notes={referenceNotes} onNoteChange={(key, note) => setReferenceNotes((current) => ({ ...current, [key]: note }))} />
            <p className="muted">New versions freeze the project and asset references with their notes.</p>
            <fieldset disabled={locked} className="idea-settings">
              <legend>Generation settings</legend>
              <div className="idea-settings-grid">
                <div className="space-y-2">
                  {isGraphics && type !== "cad" ? (
                    <>
                      <Label htmlFor="idea-canvas">Canvas</Label>
                      <Select
                        name="imageSize"
                        value={imageSize}
                        onValueChange={(value: typeof imageSize) =>
                          setImageSize(value)
                        }
                      >
                        <SelectTrigger id="idea-canvas" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1024x1024">Square</SelectItem>
                          <SelectItem value="1024x1536">Portrait</SelectItem>
                          <SelectItem value="1536x1024">Landscape</SelectItem>
                        </SelectContent>
                      </Select>
                    </>
                  ) : (
                    <>
                      <Label htmlFor="idea-rounds">{type === "cad" ? "Review rounds" : "Review rounds per stage"}</Label>
                      <Input
                        id="idea-rounds"
                        name="iterations"
                        type="number"
                        min={0}
                        max={5}
                        value={judgeIterations}
                        onChange={(event) =>
                          setJudgeIterations(event.target.valueAsNumber)
                        }
                        required
                      />
                    </>
                  )}
                </div>
              </div>
              {isGraphics && type !== "cad" && (
                <div className="space-y-2">
                  <Label htmlFor="idea-rounds">Review rounds</Label>
                  <Input
                    id="idea-rounds"
                    name="iterations"
                    type="number"
                    min={0}
                    max={5}
                    value={judgeIterations}
                    onChange={(event) => setJudgeIterations(event.target.valueAsNumber)}
                    required
                  />
                </div>
              )}
              <p className="idea-settings-note">
                {type === "cad"
                  ? judgeIterations === 0 ? "Build and measure the CAD model once, with no visual review."
                    : `Review seven rendered views and measured requirements for up to ${judgeIterations} rounds; a pass ends review early.`
                  : isGraphics
                  ? judgeIterations === 0
                    ? "Each graphic is generated once, with no review."
                    : `A reviewer inspects each rendered graphic and requests fixes, for up to ${judgeIterations} round${judgeIterations === 1 ? "" : "s"}; a pass ends review early. More rounds add time and cost.`
                  : judgeIterations === 0
                    ? "Four modeling passes with photographs, no judge review or score."
                    : `Up to ${judgeIterations} review round${judgeIterations === 1 ? "" : "s"} each for geometry and materials. Geometry must pass first; a pass ends review early. More rounds add time and cost.`}
              </p>
              {!isGraphics && <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input id="skip-visual-mock" type="checkbox" className="workshop-checkbox" checked={skipVisualMock} onChange={(event) => setSkipVisualMock(event.target.checked)} />
                  <Label htmlFor="skip-visual-mock">Skip visual mock</Label>
                </div>
                <p className="muted">{skipVisualMock ? "Build directly from the approved design and brief, without generating a concept image." : "Generate a visual target first. Review, revise, and approve it before the 3D build starts."}</p>
              </div>}
              {!isGraphics && (
                <div className="idea-sprite">
                  <div className="idea-sprite-toggle">
                    <input
                      id="idea-sprite"
                      type="checkbox"
                      name="spriteTarget"
                      className="workshop-checkbox"
                      checked={spriteEnabled}
                      onChange={(event) =>
                        setSpriteEnabled(event.target.checked)
                      }
                    />
                    <Label htmlFor="idea-sprite">Build for sprite delivery</Label>
                  </div>
                  {spriteEnabled && (
                    <div className="idea-settings-grid mt-4">
                      <div className="space-y-2">
                        <Label htmlFor="idea-sprite-size">Sprite cell size</Label>
                        <Select name="spriteSize" defaultValue={String(idea?.input.spriteTarget?.size ?? 64)}>
                          <SelectTrigger id="idea-sprite-size" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[32, 64, 128, 256].map((n) => (
                              <SelectItem key={n} value={String(n)}>
                                {n}px
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="idea-sprite-frames">
                          Animation frames
                        </Label>
                        <Input
                          id="idea-sprite-frames"
                          type="number"
                          name="spriteFrames"
                          min={1}
                          max={16}
                          defaultValue={idea?.input.spriteTarget?.frameCount ?? 1}
                          required
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </fieldset>
            {!ready && (
              <p className="note">
                The design must be approved before drafting with AI or starting
                generation.
              </p>
            )}
          </div>
          {error && (
            <Alert variant="destructive" className="error mb-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="setup-footer">
            <DialogClose asChild>
              <Button variant="outline" type="button" disabled={locked}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant={!idea && ready ? "outline" : "default"}
              name="save"
              disabled={locked}
            >
              {busy === "save" && <LoaderCircle size={17} className="spin" />}
              {busy === "save" ? "Saving…" : idea ? "Save asset" : ready ? "Save for later" : "Save asset"}
            </Button>
            {!idea && ready && (
              <Button name="start" disabled={locked}>
                {busy === "start" ? <LoaderCircle size={17} className="spin" /> : <Play size={16} />}
                {busy === "start" ? "Starting…" : "Save and start generation"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
