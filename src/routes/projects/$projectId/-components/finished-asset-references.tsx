import { useState } from "react";
import { AssetImage } from "@/components/asset-image";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fileUrl } from "@/lib/client";
import { MAX_REFERENCE_IMAGES } from "@/lib/image-file";
import type { finishedAssetReferences } from "../-lib/finished-asset-references";

export function FinishedAssetReferences({ images, count, disabled, onAdd }: {
  images: ReturnType<typeof finishedAssetReferences>;
  count: number;
  disabled: boolean;
  onAdd: (key: string) => Promise<void>;
}) {
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");
  const full = count >= MAX_REFERENCE_IMAGES;
  async function add(key: string) {
    setPending(key);
    setError("");
    try {
      await onAdd(key);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not add this reference");
    } finally {
      setPending(undefined);
    }
  }
  return <details className="mt-4">
    <summary className="cursor-pointer">Add from finished assets</summary>
    <p className="muted my-3">Choose an image or rendered photo from this project's finished assets. It is copied into your draft references.</p>
    {full && <p role="status">Remove a reference before adding another. You can use up to six.</p>}
    {!images.length && <p className="muted">No finished asset images or photos are available yet.</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="grid grid-cols-2 gap-3">
      {images.map((image) => <Button key={`${image.versionId}-${image.key}`} type="button" variant="outline"
        className="h-auto min-w-0 flex-col items-stretch overflow-hidden p-2 whitespace-normal"
        disabled={disabled || !!pending || full} onClick={() => void add(image.key)}
        aria-label={`Use ${image.name} · ${image.label} as design reference`}>
        <AssetImage src={fileUrl(image.key)} width={320} alt={image.name} className="aspect-square w-full object-contain" />
        <span className="break-words">{image.name}</span>
        <span className="text-xs text-muted-foreground">{pending === image.key ? "Adding…" : image.label}</span>
      </Button>)}
    </div>
  </details>;
}
