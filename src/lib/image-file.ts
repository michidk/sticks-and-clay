export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_REFERENCE_IMAGES = 6;
export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

// One UI representation for selected files and already persisted references.
export type ImageFile = {
  readonly id: string;
  readonly preview: string;
  readonly name: string;
} & (
  | { readonly file: File; readonly key?: never }
  | { readonly key: string; readonly file?: never }
);

export function imageMimeType(bytes: Uint8Array) {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  throw new Error("Use PNG, JPG or WebP reference images");
}

export async function validateImageFile(file: Blob) {
  if (!file.size || file.size > MAX_IMAGE_BYTES)
    throw new Error("Images must be between 1 byte and 8 MB");
  return imageMimeType(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
}

export async function validateImageSelection(
  files: readonly File[],
  existingCount: number,
) {
  if (files.length + existingCount > MAX_REFERENCE_IMAGES)
    throw new Error(
      "You can add up to 6 reference images. Remove an image first.",
    );
  await Promise.all(files.map(validateImageFile));
}

export function appendReferenceImages(
  form: FormData,
  images: readonly ImageFile[],
) {
  form.set(
    "references",
    JSON.stringify(images.flatMap((image) => (image.key ? [image.key] : []))),
  );
  form.delete("images");
  for (const image of images) if (image.file) form.append("images", image.file);
}
