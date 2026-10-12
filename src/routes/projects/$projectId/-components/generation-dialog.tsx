import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MarkdownTextarea } from "@/components/markdown-textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { FileText, LoaderCircle, Plus } from "lucide-react";
import { request, json } from "@/lib/client";
import type { RuntimeSettings } from "@/lib/contracts";

type GenerationDialogProps = {
  projectId: string;
  designVersion: number;
  ready: boolean;
  isGraphics: boolean;
  open: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onError: (error: string) => void;
  onRefresh: () => Promise<unknown>;
  onSaved: () => Promise<void>;
};

export function GenerationDialog({
  projectId,
  designVersion,
  ready,
  isGraphics,
  open,
  error,
  onOpenChange,
  onError,
  onRefresh,
  onSaved,
}: GenerationDialogProps) {
  const [busy, setBusy] = useState(false);
  const [modelBrief, setModelBrief] = useState("");
  const [modelCount, setModelCount] = useState(1);
  const [spriteEnabled, setSpriteEnabled] = useState(false);
  const [judgeIterations, setJudgeIterations] = useState(2);
  const [imageSize, setImageSize] =
    useState<RuntimeSettings["generationDefaults"]["imageSize"]>("1024x1024");
  const [briefSubmitting, setBriefSubmitting] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const briefing = briefSubmitting;
  const assetPlural = isGraphics ? "graphics" : "models";
  useEffect(() => {
    setModelBrief("");
    setSpriteEnabled(false);
  }, [projectId]);
  useEffect(() => {
    let active = true;
    void request<{ settings: RuntimeSettings }>("settings")
      .then(({ settings }) => {
        if (!active) return;
        setModelCount(settings.generationDefaults.count);
        setJudgeIterations(settings.generationDefaults.judgeIterations);
        setImageSize(settings.generationDefaults.imageSize);
      })
      .catch((error) => {
        if (active) onError(error.message);
      });
    return () => {
      active = false;
    };
  }, [onError]);
  async function generateBrief() {
    setBriefSubmitting(true);
    onError("");
    try {
      const result = await request<{ brief: string }>(
        `projects/${projectId}/model-brief`,
        json({
          count: modelCount,
          hint: modelBrief,
        }),
      );
      setModelBrief(result.brief);
      await onRefresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBriefSubmitting(false);
    }
  }
  async function saveIdea(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    onError("");
    try {
      const f = new FormData(e.currentTarget);
      await request(
        `projects/${projectId}/ideas`,
        json({
          prompt: f.get("prompt"),
          spriteTarget:
            f.get("spriteTarget") === "on"
              ? {
                  size: Number(f.get("spriteSize")),
                  directions: 8,
                  frameCount: Number(f.get("spriteFrames")),
                  pixel: true,
                  loop: true,
                }
              : undefined,
          count: Number(f.get("count")),
          judgeIterations: isGraphics ? 0 : Number(f.get("iterations")),
          imageSize: isGraphics ? f.get("imageSize") : "1024x1024",
        }),
      );
      setModelBrief("");
      onOpenChange(false);
      await onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !busy && !briefing) onOpenChange(false);
      }}
    >
      <DialogContent
        className="setup-dialog idea-dialog"
        showCloseButton={!busy && !briefing}
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
          <div className="eyebrow">EXPAND YOUR COLLECTION</div>
          <DialogTitle>Add {isGraphics ? "graphic" : "model"} ideas</DialogTitle>
          <DialogDescription>
            Capture a brief now. Generate from approved design v{designVersion}{" "}
            when you're ready.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={saveIdea} className="setup-form">
          <div className="setup-fields">
            <div className="brief-field">
              <div className="field-heading flex-wrap">
                <Label htmlFor="model-brief">
                  {isGraphics ? "Graphic" : "Model"} brief (optional)
                </Label>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  disabled={busy || briefing || !ready ||
                    !Number.isInteger(modelCount) || modelCount < 1 || modelCount > 20}
                  onClick={() => generateBrief()}
                >
                  {briefing ? <LoaderCircle className="spin" size={16} /> : <FileText size={16} />}
                  {briefing ? "Writing brief…" : "Draft brief with AI"}
                </Button>
              </div>
              <MarkdownTextarea
                id="model-brief"
                name="prompt"
                value={modelBrief}
                onChange={(e) => setModelBrief(e.target.value)}
                disabled={busy || briefing}
                maxLength={12000}
                rows={5}
                placeholder={`Describe the ${assetPlural} you have in mind, or leave blank to let AI propose a set.`}
              />
              <p className="m-0 text-xs text-muted-foreground" role={briefing ? "status" : undefined}>
                {briefing ? "Writing a brief from your approved design…" : "AI brief drafting is paid and recorded in Activity & cost."}
              </p>
            </div>
            <fieldset disabled={busy || briefing} className="idea-settings">
              <legend>Generation settings</legend>
              <div className="idea-settings-grid">
                <div className="space-y-2">
                  <Label htmlFor="idea-count">Number of {assetPlural}</Label>
                  <Input id="idea-count" name="count" type="number" min={1} max={20}
                    value={modelCount} onChange={(event) => setModelCount(event.target.valueAsNumber)} required />
                </div>
                <div className="space-y-2">
                  {isGraphics ? <>
                    <Label htmlFor="idea-canvas">Canvas</Label>
                    <Select name="imageSize" value={imageSize}
                      onValueChange={(value: typeof imageSize) => setImageSize(value)}>
                      <SelectTrigger id="idea-canvas" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1024x1024">Square</SelectItem>
                        <SelectItem value="1024x1536">Portrait</SelectItem>
                        <SelectItem value="1536x1024">Landscape</SelectItem>
                      </SelectContent>
                    </Select>
                  </> : <>
                    <Label htmlFor="idea-rounds">Review rounds per stage</Label>
                    <Input id="idea-rounds" name="iterations" type="number" min={0} max={5}
                      value={judgeIterations} onChange={(event) => setJudgeIterations(event.target.valueAsNumber)} required />
                  </>}
                </div>
              </div>
              <p className="idea-settings-note">
                {isGraphics
                  ? "Each graphic is saved as a PNG on the chosen canvas."
                  : judgeIterations === 0
                    ? "Four modeling passes with photographs, without judging or a review score."
                    : `Up to ${judgeIterations} review round${judgeIterations === 1 ? "" : "s"} each for geometry and materials. Geometry must pass first; passing ends review early. More rounds add time and cost.`}
              </p>
              {!isGraphics && <div className="idea-sprite">
                <div className="idea-sprite-toggle">
                  <input id="idea-sprite" type="checkbox" name="spriteTarget" className="workshop-checkbox"
                    checked={spriteEnabled} onChange={(event) => setSpriteEnabled(event.target.checked)} />
                  <Label htmlFor="idea-sprite">Generate for sprite delivery</Label>
                  <span>Optional</span>
                </div>
                {spriteEnabled && <div className="idea-settings-grid mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="idea-sprite-size">Sprite cell size</Label>
                    <Select name="spriteSize" defaultValue="64">
                      <SelectTrigger id="idea-sprite-size" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[32, 64, 128, 256].map((n) => <SelectItem key={n} value={String(n)}>{n}px</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="idea-sprite-frames">Animation frames</Label>
                    <Input id="idea-sprite-frames" type="number" name="spriteFrames" min={1} max={16} defaultValue={1} required />
                  </div>
                </div>}
              </div>}
            </fieldset>
            {!ready && <p className="note">Approve the design before drafting a brief with AI or starting generation.</p>}
            {error && <Alert variant="destructive" className="error"><AlertDescription>{error}</AlertDescription></Alert>}
          </div>
          <div className="setup-footer idea-footer">
            <p>Saved to {isGraphics ? "Graphic" : "Model"} ideas. Generation starts later.</p>
            <Button disabled={busy || briefing}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <Plus size={17} />}
              {busy ? "Saving idea…" : "Save idea"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
