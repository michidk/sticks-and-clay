import { useEffect, useRef, useState } from "react";
import { fileUrl, json, request } from "@/lib/client";
import {
  type ImageFile,
  validateImageSelection,
  validateImageFile,
  MAX_REFERENCE_IMAGES,
} from "@/lib/image-file";

export function useImageUpload() {
  const [images, setImages] = useState<readonly ImageFile[]>([]);
  const [isBusy, setBusy] = useState(false);
  const current = useRef<readonly ImageFile[]>([]);
  const locked = useRef(false);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
      current.current.forEach((image) => {
        if (image.file) URL.revokeObjectURL(image.preview);
      });
    };
  }, []);

  function update(next: readonly ImageFile[]) {
    current.current = next;
    setImages(next);
  }
  function reset(keys: readonly string[] = []) {
    current.current.forEach((image) => {
      if (image.file) URL.revokeObjectURL(image.preview);
    });
    update(
      keys.map((key, index) => ({
        id: key,
        key,
        preview: fileUrl(key),
        name: `Saved reference ${index + 1}`,
      })),
    );
  }
  function remove(id: string) {
    if (locked.current) return;
    const image = current.current.find((item) => item.id === id);
    if (image?.file) URL.revokeObjectURL(image.preview);
    update(current.current.filter((item) => item.id !== id));
  }
  async function intake(load: () => Promise<readonly File[]>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const selected = await load();
      await validateImageSelection(selected, current.current.length);
      const files = await Promise.all(
        selected.map(
          async (file) =>
            new File([file], file.name, {
              type: await validateImageFile(file),
              lastModified: file.lastModified,
            }),
        ),
      );
      if (!alive.current) return;
      update([
        ...current.current,
        ...files.map((file) => ({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          preview: URL.createObjectURL(file),
        })),
      ]);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const addFiles = (files: readonly File[]) => intake(async () => files);
  const importFromUrl = (url: string) =>
    intake(async () => {
      if (current.current.length >= MAX_REFERENCE_IMAGES)
        throw new Error(
          "You can add up to 6 reference images. Remove an image first.",
        );
      controller.current = new AbortController();
      const result = await request<{
        base64: string;
        filename: string;
        mimeType: string;
      }>("images/import", {
        ...json({ url }),
        signal: controller.current.signal,
      });
      const bytes = Uint8Array.from(atob(result.base64), (char) =>
        char.charCodeAt(0),
      );
      return [new File([bytes], result.filename, { type: result.mimeType })];
    });

  return {
    images,
    isBusy,
    fileInputRef,
    addFiles,
    importFromUrl,
    remove,
    reset,
  };
}
