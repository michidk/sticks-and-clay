import { z } from "zod";
import { assetTypeSchema } from "../../lib/asset-types";
import {
  IMAGE_MIME_TYPES,
  MAX_IMAGE_BYTES,
  MAX_REFERENCE_IMAGES,
  validateImageFile,
} from "../../lib/image-file";
import { downloadImage } from "../../lib/remote-image.server";

const MAX_ASSET_BYTES = 200 * 1024 * 1024;
const filename = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (name) => !/[<>:"/\\|?*\x00-\x1f]/.test(name) && name !== "." && name !== "..",
    "Use a filename without directories or reserved characters",
  );

function base64(maxBytes: number) {
  const maxLength = Math.ceil(maxBytes / 3) * 4;
  return z
    .string()
    .min(4)
    .max(maxLength)
    .refine(
      (value) =>
        value.length <= maxLength &&
        value.length % 4 === 0 &&
        Buffer.byteLength(value, "base64") <= maxBytes &&
        Buffer.from(value, "base64").toString("base64") === value,
      "Use canonical base64 within the upload size limit",
    );
}

export const imageUploadSchema = z.union([
  z.strictObject({
    url: z.url({ protocol: /^https?$/ }).max(2048),
  }),
  z.strictObject({
    filename,
    mimeType: z.enum(IMAGE_MIME_TYPES),
    base64: base64(MAX_IMAGE_BYTES),
  }),
]);

export const assetUploadSchema = z.strictObject({
  filename,
  base64: base64(MAX_ASSET_BYTES),
});

export const projectSetupInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(12000).default(""),
    assetType: assetTypeSchema.default("model"),
    draftId: z.string().uuid().optional(),
    images: z.array(imageUploadSchema).max(MAX_REFERENCE_IMAGES).default([]),
    references: z.array(z.string()).max(MAX_REFERENCE_IMAGES).optional(),
  })
  .refine(
    (input) =>
      input.images.length + (input.references?.length ?? 0) <= MAX_REFERENCE_IMAGES,
    "You can add up to 6 reference images. Remove an image first.",
  );

export async function projectForm(
  input: z.output<typeof projectSetupInput>,
): Promise<FormData> {
  const form = new FormData();
  form.set("name", input.name);
  form.set("description", input.description);
  form.set("assetType", input.assetType);
  if (input.draftId) form.set("draftId", input.draftId);
  if (input.references !== undefined)
    form.set("references", JSON.stringify(input.references));
  for (const image of input.images) {
    const upload = "url" in image ? await downloadImage(image.url) : image;
    const file = new File(
      [new Uint8Array(Buffer.from(upload.base64, "base64"))],
      upload.filename,
      { type: upload.mimeType },
    );
    if ((await validateImageFile(file)) !== upload.mimeType)
      throw new Error("The image content does not match its format");
    form.append("images", file);
  }
  return form;
}

export async function assetForm(input: {
  name: string;
  prompt: string;
  file: z.output<typeof assetUploadSchema>;
}): Promise<FormData> {
  const bytes = Buffer.from(input.file.base64, "base64");
  if (
    bytes.subarray(0, 7).toString() !== "BLENDER" &&
    !(
      bytes.length >= 20 &&
      bytes.toString("ascii", 0, 4) === "glTF" &&
      bytes.readUInt32LE(4) === 2 &&
      bytes.readUInt32LE(8) === bytes.length
    )
  )
    throw new Error("Invalid GLB or Blender source");
  const form = new FormData();
  form.set("name", input.name);
  form.set("prompt", input.prompt);
  form.set("file", new File([new Uint8Array(bytes)], input.file.filename));
  return form;
}
