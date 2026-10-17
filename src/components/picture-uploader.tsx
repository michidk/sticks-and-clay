import {
  useId,
  useEffect,
  useState,
  type ClipboardEvent,
} from "react";
import Uppy, { type UppyFile } from "@uppy/core";
import Dashboard from "@uppy/react/dashboard";
import "@uppy/core/css/style.min.css";
import "@uppy/dashboard/css/style.min.css";
import {
  ChevronDown,
  Link2,
  LoaderCircle,
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
import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES,
  type ImageFile,
} from "@/lib/image-file";

type Props = {
  images: readonly ImageFile[];
  onFilesAdded: (files: readonly File[]) => Promise<void>;
  onImportFromUrl: (url: string) => Promise<void>;
  onRemove: (id: string) => void;
  disabled?: boolean;
  isBusy?: boolean;
  /** Replaces the default "Reference images (optional)" heading. */
  title?: string;
};

// Uppy owns local intake; saved files and URL imports share the app's file model.
export function PictureUploader({
  images,
  onFilesAdded,
  onImportFromUrl,
  onRemove,
  disabled,
  isBusy,
  title,
}: Props) {
  const [urlOpen, setUrlOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState("");
  const [uppy] = useState(
    () =>
      new Uppy({
        autoProceed: false,
        restrictions: {
          allowedFileTypes: [...IMAGE_MIME_TYPES],
          maxFileSize: MAX_IMAGE_BYTES,
          maxNumberOfFiles: MAX_REFERENCE_IMAGES,
        },
      }),
  );
  const id = useId();
  const busy = disabled || isBusy;
  const full = images.length >= MAX_REFERENCE_IMAGES;

  useEffect(() => {
    uppy.setOptions({
      restrictions: {
        allowedFileTypes: [...IMAGE_MIME_TYPES],
        maxFileSize: MAX_IMAGE_BYTES,
        maxNumberOfFiles: Math.max(1, MAX_REFERENCE_IMAGES - images.length),
      },
    });
  }, [images.length, uppy]);

  useEffect(() => {
    function filesAdded(
      files: UppyFile<Record<string, unknown>, Record<string, unknown>>[],
    ) {
      const selected = files.flatMap((file) =>
        file.data instanceof File ? [file.data] : [],
      );
      if (!selected.length) return;
      setError("");
      void onFilesAdded(selected)
        .catch((error) => setError((error as Error).message))
        .finally(() => uppy.removeFiles(files.map((file) => file.id)));
    }
    function restrictionFailed(
      _file:
        | UppyFile<Record<string, unknown>, Record<string, unknown>>
        | undefined,
      error: Error,
    ) {
      // Uppy emits this before `files-added` for a mixed valid/invalid batch.
      queueMicrotask(() => setError(error.message));
    }
    uppy.on("files-added", filesAdded);
    uppy.on("restriction-failed", restrictionFailed);
    return () => {
      uppy.off("files-added", filesAdded);
      uppy.off("restriction-failed", restrictionFailed);
    };
  }, [onFilesAdded, uppy]);

  useEffect(() => () => uppy.destroy(), [uppy]);

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
    // Uppy handles image files. This wrapper only turns pasted URLs into the
    // app's URL-import flow.
    if (!event.clipboardData.files.length) {
      const text = event.clipboardData.getData("text/plain").trim();
      if (/^https?:\/\//i.test(text)) {
        event.preventDefault();
        setImageUrl(text);
        setUrlOpen(true);
      }
    }
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
          {title ?? (
            <>
              Reference images{" "}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </>
          )}
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
        <div className="reference-uppy" aria-describedby={id + "-hint"}>
          <Dashboard
            uppy={uppy}
            width="100%"
            height={150}
            disabled={Boolean(busy || full)}
            hideUploadButton
            disableStatusBar
            showSelectedFiles={false}
            proudlyDisplayPoweredByUppy={false}
            locale={{
              strings: {
                dropPasteFiles: "Drop files here, paste, or %{browseFiles}",
              },
            }}
            note={
              full
                ? "All 6 references added — remove one to add another"
                : "Choose files, drag and drop, or paste an image"
            }
          />
          {isBusy && (
            <span className="reference-uppy-busy" aria-live="polite">
              <LoaderCircle className="spin size-5" /> Adding image…
            </span>
          )}
        </div>
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
      {error && (
        <Alert variant="destructive" role="alert" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
