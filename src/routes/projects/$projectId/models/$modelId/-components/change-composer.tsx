import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImagePlus, LoaderCircle, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { IMAGE_MIME_TYPES, MAX_IMAGE_BYTES } from "@/lib/image-file";
import { MAX_CHANGE_IMAGES } from "@/lib/object-reference";
import { json } from "@/lib/client";

type Attachment = { id: string; file: File; preview: string };

/** The branch request; attached images make it multipart, as the API expects. */
export function branchRequest(input: Record<string, unknown>, images: readonly File[]): RequestInit {
  if (!images.length) return json(input);
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  for (const image of images) form.append("images", image);
  return { method: "POST", body: form };
}

/**
 * The change composer shared by the 3D and graphic pages: a prompt with pasted, dropped or attached
 * images, optional context chips and mode buttons, review rounds and a send button (Ctrl or ⌘ + Enter).
 */
export function ChangeComposer({
  hint,
  context,
  modes,
  beforeBox,
  footer,
  rounds,
  onRoundsChange,
  placeholder,
  sendLabel,
  disabled,
  allowEmpty = false,
  visualTarget,
  onVisualTargetChange,
  onSubmit,
}: {
  /** One line above the box: what the change continues from. */
  hint: ReactNode;
  /** Chips for referenced parts, shown with the attached images. */
  context?: ReactNode;
  modes?: ReactNode;
  beforeBox?: ReactNode;
  footer?: ReactNode;
  rounds: number;
  onRoundsChange: (rounds: number) => void;
  placeholder: string;
  sendLabel: string;
  disabled?: boolean;
  /** A blank prompt without images is allowed (graphics regenerate from the saved result). */
  allowEmpty?: boolean;
  /** Whether the change first makes a new visual target for approval; the switch shows when this is handled. */
  visualTarget?: boolean;
  onVisualTargetChange?: (visualTarget: boolean) => void;
  /** Throws to show its message; resolves after the change was queued. */
  onSubmit: (input: { prompt: string; images: File[] }) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [images, setImages] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const filePicker = useRef<HTMLInputElement>(null);
  const previews = useRef(images);
  previews.current = images;
  useEffect(() => () => previews.current.forEach((image) => URL.revokeObjectURL(image.preview)), []);
  const trimmed = prompt.trim();
  const validPrompt = trimmed.length >= 3 || (allowEmpty && !trimmed && !images.length);
  const canSubmit = !busy && !disabled && validPrompt && Number.isInteger(rounds) && rounds >= 0 && rounds <= 5;

  function attachImages(files: Iterable<File>) {
    const accepted: File[] = [];
    for (const file of files) {
      if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
        setError("Attach PNG, JPG or WebP images");
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError("Images must be 8 MB or smaller");
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;
    const room = MAX_CHANGE_IMAGES - images.length;
    if (accepted.length > room) setError(`Attach at most ${MAX_CHANGE_IMAGES} images to a change`);
    else setError("");
    const added = accepted.slice(0, Math.max(room, 0)).map((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
      file,
      preview: URL.createObjectURL(file),
    }));
    if (added.length) setImages((current) => [...current, ...added]);
  }
  function removeImage(id: string) {
    setImages((current) => {
      const image = current.find((item) => item.id === id);
      if (image) URL.revokeObjectURL(image.preview);
      return current.filter((item) => item.id !== id);
    });
  }
  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit({ prompt: trimmed, images: images.map((image) => image.file) });
      setPrompt("");
      images.forEach((image) => URL.revokeObjectURL(image.preview));
      setImages([]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not queue the change");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio-chat-compose">
      <p className="studio-compose-source">{hint}</p>
      {beforeBox}
      <div
        className={"studio-compose-box" + (dragging ? " is-dragging" : "")}
        onDragOver={(event) => {
          if (disabled || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          if (disabled || !event.dataTransfer.files.length) return;
          event.preventDefault();
          setDragging(false);
          attachImages(event.dataTransfer.files);
        }}
      >
        {(context || images.length > 0) && (
          <div className="studio-compose-context" aria-label="Context for this change">
            {context}
            {images.map((image, index) => (
              <span key={image.id} className="studio-compose-image">
                <img src={image.preview} alt={`Attached image ${index + 1}: ${image.file.name}`} />
                <button type="button" aria-label={`Remove attached image ${index + 1}`} onClick={() => removeImage(image.id)}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <Textarea
          id="continuation-prompt"
          aria-label="What should change?"
          value={prompt}
          disabled={disabled}
          onChange={(event) => setPrompt(event.target.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (!files.length) return;
            event.preventDefault();
            attachImages(files);
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          maxLength={12000}
          placeholder={placeholder}
          rows={3}
        />
        <div className="studio-compose-row">
          {modes}
          <input
            ref={filePicker}
            type="file"
            accept={IMAGE_MIME_TYPES.join(",")}
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) attachImages(event.target.files);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="studio-compose-attach"
            aria-label="Attach images"
            title={`Attach images (up to ${MAX_CHANGE_IMAGES})`}
            disabled={disabled || images.length >= MAX_CHANGE_IMAGES}
            onClick={() => filePicker.current?.click()}
          >
            <ImagePlus />
          </Button>
          {onVisualTargetChange && (
            <Label
              htmlFor="continuation-visual-target"
              className="studio-compose-target"
              title="On: draft a new visual target and wait for your approval. Off: build straight from the saved version."
            >
              <Switch
                id="continuation-visual-target"
                checked={!!visualTarget}
                disabled={disabled}
                onCheckedChange={onVisualTargetChange}
              />
              New visual target
            </Label>
          )}
          <Label htmlFor="continuation-rounds" className="studio-compose-rounds">
            Review rounds
            <Input
              id="continuation-rounds"
              type="number"
              min={0}
              max={5}
              value={rounds}
              disabled={disabled}
              onChange={(event) => onRoundsChange(Number(event.target.value))}
            />
          </Label>
          <Button type="button" size="icon" aria-label={sendLabel} title={sendLabel} disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="spin" /> : <Send />}
          </Button>
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {footer}
    </div>
  );
}
