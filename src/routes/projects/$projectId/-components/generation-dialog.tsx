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
  const [judgeIterations, setJudgeIterations] = useState(2);
  const [imageSize, setImageSize] =
    useState<RuntimeSettings["generationDefaults"]["imageSize"]>("1024x1024");
  const [briefSubmitting, setBriefSubmitting] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const briefing = briefSubmitting;
  const assetPlural = isGraphics ? "graphics" : "models";
  useEffect(() => {
    setModelBrief("");
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
        showCloseButton={!busy && !briefing}
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
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
          <DialogTitle className="text-[27px]">
            Add {isGraphics ? "graphic" : "model"} ideas
          </DialogTitle>
          <DialogDescription className="muted">
            Save a brief for later. Start generation from your ideas when you're
            ready, using the approved design. Current design: v{designVersion}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={saveIdea}>
          <div className="form-row">
            <Label>
              Number of {assetPlural}
              <Input
                name="count"
                type="number"
                min={1}
                max={20}
                value={modelCount}
                disabled={briefing}
                onChange={(e) => setModelCount(e.target.valueAsNumber)}
                required
              />
            </Label>
            {!isGraphics && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <input type="checkbox" name="spriteTarget" />
                  Generate for sprite delivery
                </Label>
                <Label>
                  Sprite cell size
                  <Select name="spriteSize" defaultValue="64">
                    <SelectTrigger>
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
                </Label>
                <Label>
                  Sprite animation frames
                  <Input
                    type="number"
                    name="spriteFrames"
                    min={1}
                    max={16}
                    defaultValue={1}
                  />
                </Label>
              </div>
            )}
            {isGraphics ? (
              <Label>
                Canvas
                <Select
                  name="imageSize"
                  value={imageSize}
                  onValueChange={(value: typeof imageSize) =>
                    setImageSize(value)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1024x1024">Square</SelectItem>
                    <SelectItem value="1024x1536">Portrait</SelectItem>
                    <SelectItem value="1536x1024">Landscape</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
            ) : (
              <Label>
                Review rounds per stage
                <Input
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
              </Label>
            )}
          </div>
          <div className="brief-field">
            <div className="field-heading">
              <Label htmlFor="model-brief">
                {isGraphics ? "Graphic" : "Model"} brief (optional)
              </Label>
              <Button
                variant="outline"
                size="sm"
                type="button"
                disabled={
                  busy ||
                  briefing ||
                  !ready ||
                  !Number.isInteger(modelCount) ||
                  modelCount < 1 ||
                  modelCount > 20
                }
                onClick={() => generateBrief()}
              >
                {briefing ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <FileText size={16} />
                )}
                {briefing ? "Writing brief…" : "Draft brief with AI"}
              </Button>
            </div>
            <MarkdownTextarea
              id="model-brief"
              name="prompt"
              value={modelBrief}
              onChange={(e) => setModelBrief(e.target.value)}
              disabled={briefing}
              maxLength={12000}
              rows={5}
              placeholder={`Describe specific ${assetPlural}, or leave blank to let AI choose from your approved design.`}
            />
          </div>
          {briefing && (
            <p role="status" className="muted">
              Writing a brief from your approved design…
            </p>
          )}
          <p className="note">
            Saving an idea does not start generation. Drafting a brief with AI
            uses paid AI and is recorded in Activity & cost.
          </p>
          {!ready && <p className="note">Approve the design before drafting a brief with AI or starting generation.</p>}
          <p className="note">
            {isGraphics
              ? "Each graphic is generated on your chosen canvas and saved as a PNG. Usage is recorded in Activity & cost."
              : judgeIterations === 0
                ? "No judging: each model still gets blockout, shape refinement, materials and polish, with photographs. It will finish without a review score."
                : `Up to ${judgeIterations} review round${judgeIterations === 1 ? "" : "s"} for geometry, then ${judgeIterations} for materials. Passing ends review early; geometry must pass before materials begin. More rounds can increase time and cost.`}
          </p>
          {error && (
            <Alert variant="destructive" className="error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button
            variant="default"
            className="wide"
            disabled={busy || briefing}
          >
            <Plus size={17} />
            {busy ? "Saving idea…" : "Save idea"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
