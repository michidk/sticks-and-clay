import {
  useId,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type RefObject,
} from "react";
import {
  ChevronDown,
  ImagePlus,
  Link2,
  LoaderCircle,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { AssetImage } from "@/components/asset-image";
import type { ImageFile } from "@/lib/image-file";

type Props = {
  images: readonly ImageFile[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFilesAdded: (files: readonly File[]) => Promise<void>;
  onImportFromUrl: (url: string) => Promise<void>;
  onRemove: (id: string) => void;
  disabled?: boolean;
  isBusy?: boolean;
};

// Adapted from Roastbook's PictureUploader: all intake paths share one file model.
export function PictureUploader({
  images,
  fileInputRef,
  onFilesAdded,
  onImportFromUrl,
  onRemove,
  disabled,
  isBusy,
}: Props) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const id = useId();
  const busy = disabled || isBusy;
  const full = images.length >= 6;
  async function addFiles(files: readonly File[]) {
    if (busy || !files.length) return;
    setError("");
    try {
      await onFilesAdded(files);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function importUrl() {
    if (busy || !imageUrl.trim()) return;
    setError("");
    try {
      await onImportFromUrl(imageUrl.trim());
      setImageUrl("");
      setUrlOpen(false);
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function paste(event: ClipboardEvent<HTMLDivElement>) {
    if (busy) return;
    const target = event.target;
    // Pasting text in form fields should continue to work normally.
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, [contenteditable=true]")
    )
      return;
    const files = Array.from(event.clipboardData.files);
    if (!files.length) {
      for (const item of Array.from(event.clipboardData.items)) {
        const file = item.kind === "file" ? item.getAsFile() : null;
        if (file) files.push(file);
      }
    }
    if (files.length) {
      event.preventDefault();
      event.stopPropagation();
      void addFiles(files);
    } else {
      const text = event.clipboardData.getData("text/plain").trim();
      if (/^https?:\/\//i.test(text)) {
        event.preventDefault();
        setImageUrl(text);
        setUrlOpen(true);
      }
    }
  }
  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    void addFiles(Array.from(event.dataTransfer.files));
  }
  return (
    <div
      className="reference-uploader"
      onPaste={paste}
      aria-busy={isBusy}
      aria-labelledby={id + "-title"}
    >
      <div className="reference-uploader-heading">
        <span id={id + "-title"}>
          Reference images{" "}
          <span className="text-muted-foreground font-normal">(optional)</span>
        </span>
        <span className="text-muted-foreground" aria-live="polite">
          {images.length} / 6
        </span>
      </div>
      {images.length > 0 && (
        <ul
          className="reference-previews"
          aria-label="Selected reference images"
        >
          {images.map((image, index) => (
            <li key={image.id}>
              <AssetImage
                src={image.preview}
                alt={`Reference ${index + 1}: ${image.name}`}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="reference-remove"
                disabled={busy}
                aria-label={`Remove reference ${index + 1}`}
                onClick={() => {
                  onRemove(image.id);
                  setError("");
                }}
              >
                <X size={15} />
              </Button>
              <span className="reference-caption" title={image.name}>
                {image.name}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Collapsible open={urlOpen} onOpenChange={setUrlOpen}>
        <Button
          type="button"
          variant="ghost"
          size="bare"
          className={"reference-dropzone" + (dragging ? " is-dragging" : "")}
          disabled={busy || full}
          aria-describedby={id + "-hint"}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!busy && !full) setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDragging(false);
          }}
          onDrop={drop}
        >
          <span className="reference-upload-icon">
            {isBusy ? (
              <LoaderCircle className="spin size-6" />
            ) : dragging ? (
              <UploadCloud className="size-6" />
            ) : (
              <ImagePlus className="size-6" />
            )}
          </span>
          <span>
            <strong>
              {isBusy
                ? "Adding image…"
                : full
                  ? "All 6 references added"
                  : dragging
                    ? "Drop images here"
                    : images.length
                      ? "Add more references"
                      : "Give your world a visual starting point"}
            </strong>
            <span>
              {full
                ? "Remove one to add another"
                : "Choose files, drag & drop, or paste an image"}
            </span>
          </span>
        </Button>
        <div className="reference-upload-options">
          <span id={id + "-hint"}>PNG, JPG or WebP · up to 8 MB each</span>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || full}
              className="reference-url-toggle"
            >
              <Link2 size={15} /> From URL{" "}
              <ChevronDown size={14} className={urlOpen ? "rotate-180" : ""} />
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="reference-url-panel">
            <Label htmlFor={id + "-url"}>Image URL</Label>
            <Input
              id={id + "-url"}
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="https://example.com/reference.jpg"
              value={imageUrl}
              disabled={busy || full}
              onChange={(event) => {
                setImageUrl(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void importUrl();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || full || !imageUrl.trim()}
              onClick={() => void importUrl()}
            >
              {isBusy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Link2 size={16} />
              )}
              {isBusy ? "Importing…" : "Add image"}
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        disabled={busy || full}
        hidden
        aria-label="Choose reference images"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          void addFiles(files);
        }}
      />
      {error && (
        <Alert variant="destructive" role="alert" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
