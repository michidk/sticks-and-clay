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
import { request, json } from "@/lib/client";
import type { ModelIdea } from "./model-ideas";
import type { RuntimeSettings } from "@/lib/contracts";

type GenerationDialogProps = {
  idea?: ModelIdea;
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
  const [error, setError] = useState("");
  const [modelBrief, setModelBrief] = useState(idea?.input.prompt || "");
  const [modelCount, setModelCount] = useState(idea?.input.count ?? 1);
  const [skipVisualMock, setSkipVisualMock] = useState(idea?.input.visualTargetMode === "skip");
  const [spriteEnabled, setSpriteEnabled] = useState(Boolean(idea?.input.spriteTarget));
  const [judgeIterations, setJudgeIterations] = useState(idea?.input.judgeIterations ?? 2);
  const [imageSize, setImageSize] =
    useState<RuntimeSettings["generationDefaults"]["imageSize"]>(idea?.input.imageSize ?? "1024x1024");
  const [briefing, setBriefing] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const assetPlural = isGraphics ? "graphics" : "models";
  useEffect(() => {
    setModelBrief(idea?.input.prompt || "");
    setSpriteEnabled(Boolean(idea?.input.spriteTarget));
    setSkipVisualMock(idea?.input.visualTargetMode === "skip");
  }, [projectId, idea]);
  useEffect(() => {
    if (idea) return;
    let active = true;
    void request<{ settings: RuntimeSettings }>("settings")
      .then(({ settings }) => {
        if (!active) return;
        setModelCount(settings.generationDefaults.count);
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
        json({ count: modelCount, hint: modelBrief }),
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
    setBusy(start ? "start" : "save");
    setError("");
    try {
      const f = new FormData(e.currentTarget);
      const saved = await request<{ id?: string }>(
        `projects/${projectId}/ideas${idea ? `/${idea.id}` : ""}`,
        json({
          prompt: f.get("prompt"),
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
          count: Number(f.get("count")),
          judgeIterations: Number(f.get("iterations")),
          imageSize: isGraphics ? f.get("imageSize") : "1024x1024",
        }, idea ? "PUT" : "POST"),
      );
      if (start && saved.id)
        await request(`projects/${projectId}/ideas/${saved.id}/generate`, json({}));
      setModelBrief("");
      onOpenChange(false);
      await onSaved(start);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = Boolean(busy) || briefing;
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
          <DialogTitle>{idea ? "Edit" : "Add"} {isGraphics ? "graphic" : "model"} {idea ? "idea" : "ideas"}</DialogTitle>
          <DialogDescription>
            {idea
              ? "Changes apply to this unstarted idea only."
              : ready
                ? `Start generation now, or save the idea and start it later from the Ideas tab. Generation uses design v${designVersion}.`
                : "Saved ideas wait in the Ideas tab until the design is approved."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={saveIdea} className="setup-form">
          <div className="setup-fields">
            <div className="brief-field">
              <div className="field-heading flex-wrap">
                <Label htmlFor="model-brief">Brief (optional)</Label>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={
                    locked ||
                    !ready ||
                    !Number.isInteger(modelCount) ||
                    modelCount < 1 ||
                    modelCount > 20
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
                placeholder={`Describe the ${assetPlural} you want. Leave blank to let AI propose a set from the design.`}
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
            <fieldset disabled={locked} className="idea-settings">
              <legend>Generation settings</legend>
              <div className="idea-settings-grid">
                <div className="space-y-2">
                  <Label htmlFor="idea-count">Number of {assetPlural}</Label>
                  <Input
                    id="idea-count"
                    name="count"
                    type="number"
                    min={1}
                    max={20}
                    value={modelCount}
                    onChange={(event) =>
                      setModelCount(event.target.valueAsNumber)
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  {isGraphics ? (
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
                      <Label htmlFor="idea-rounds">Review rounds per stage</Label>
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
              {isGraphics && (
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
                {isGraphics
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
            {error && (
              <Alert variant="destructive" className="error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
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
              {busy === "save" ? "Saving…" : idea ? "Save changes" : ready ? "Save for later" : "Save idea"}
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
