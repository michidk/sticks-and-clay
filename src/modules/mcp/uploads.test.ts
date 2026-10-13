import { expect, test } from "bun:test";
import { MAX_IMAGE_BYTES } from "../../lib/image-file";
import {
  assetForm,
  assetUploadSchema,
  imageUploadSchema,
  projectForm,
  projectSetupInput,
} from "./uploads";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const image = {
  filename: "reference.png",
  mimeType: "image/png",
  base64: png.toString("base64"),
};

test("project intake retains canonical image bytes and reference state", async () => {
  const form = await projectForm(
    projectSetupInput.parse({ name: " Collection ", images: [image] }),
  );
  expect(form.get("name")).toBe("Collection");
  expect(form.get("description")).toBe("");
  expect(form.get("assetType")).toBe("model");
  expect(form.has("references")).toBe(false);
  const file = form.get("images");
  if (!(file instanceof File)) throw new Error("Expected an uploaded image");
  expect(file.name).toBe("reference.png");
  expect(file.type).toBe("image/png");
  expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
  const removed = await projectForm(
    projectSetupInput.parse({ name: "Collection", references: [] }),
  );
  expect(removed.get("references")).toBe("[]");
  const retained = await projectForm(
    projectSetupInput.parse({
      name: "Collection",
      references: ["references/saved.png"],
    }),
  );
  expect(retained.get("references")).toBe('["references/saved.png"]');
});

test("upload schemas reject malformed base64, path names and mixed image sources", () => {
  for (const base64 of ["", "Zg", "Zh==", "Zg===", "Zg==\n", "Zg-_"])
    expect(imageUploadSchema.safeParse({ ...image, base64 }).success).toBe(false);
  expect(
    imageUploadSchema.safeParse({ ...image, base64: "Zg==" }).success,
  ).toBe(true);
  for (const filename of ["../reference.png", "a/b.png", "a\\b.png", ".", "..", "", "a".repeat(201)])
    expect(imageUploadSchema.safeParse({ ...image, filename }).success).toBe(false);
  expect(
    imageUploadSchema.safeParse({ ...image, url: "https://example.com/a.png" })
      .success,
  ).toBe(false);
  expect(
    assetUploadSchema.safeParse({
      filename: "source.glb",
      base64: image.base64,
      path: "/tmp/source.glb",
    }).success,
  ).toBe(false);
});

test("reference intake rejects spoofed signatures and MIME types", async () => {
  await expect(
    projectForm(
      projectSetupInput.parse({
        name: "Collection",
        images: [{ ...image, base64: Buffer.from("not an image").toString("base64") }],
      }),
    ),
  ).rejects.toThrow("Use PNG");
  await expect(
    projectForm(
      projectSetupInput.parse({
        name: "Collection",
        images: [{ ...image, mimeType: "image/jpeg" }],
      }),
    ),
  ).rejects.toThrow("does not match");
});

test("upload bounds count decoded bytes and retained references", () => {
  const maximum = Buffer.alloc(MAX_IMAGE_BYTES).toString("base64");
  expect(imageUploadSchema.safeParse({ ...image, base64: maximum }).success)
    .toBe(true);
  const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1).toString("base64");
  expect(imageUploadSchema.safeParse({ ...image, base64: oversized }).success)
    .toBe(false);
  expect(
    projectSetupInput.safeParse({ name: "Collection", images: Array(7).fill(image) })
      .success,
  ).toBe(false);
  expect(
    projectSetupInput.safeParse({
      name: "Collection",
      images: [image],
      references: Array.from({ length: 6 }, (_, i) => `references/${i}.png`),
    }).success,
  ).toBe(false);
});

test("URL intake accepts HTTP images and rejects unsupported or private sources", async () => {
  expect(imageUploadSchema.safeParse({ url: "https://example.com/a.png" }).success)
    .toBe(true);
  for (const url of ["not a URL", "file:///tmp/reference.png", "data:image/png;base64,Zg=="])
    expect(imageUploadSchema.safeParse({ url }).success).toBe(false);
  for (const url of ["http://127.0.0.1/a.png", "http://localhost/a.png", "https://user:pass@example.com/a.png"])
    await expect(
      projectForm(projectSetupInput.parse({ name: "Collection", images: [{ url }] })),
    ).rejects.toThrow();
});

test("asset intake verifies binary headers and preserves source bytes", async () => {
  const bytes = Buffer.alloc(20);
  bytes.write("glTF");
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  const input = {
    name: "Source",
    prompt: "Improve the source",
    file: assetUploadSchema.parse({
      filename: "source.glb",
      base64: bytes.toString("base64"),
    }),
  };
  const form = await assetForm(input);
  expect(form.get("name")).toBe("Source");
  expect(form.get("prompt")).toBe("Improve the source");
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("Expected an uploaded source");
  expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
  bytes.writeUInt32LE(1, 4);
  await expect(
    assetForm({ ...input, file: { ...input.file, base64: bytes.toString("base64") } }),
  ).rejects.toThrow("Invalid GLB");
  const blend = await assetForm({
    ...input,
    file: { filename: "source.blend", base64: Buffer.from("BLENDER-v400").toString("base64") },
  });
  expect(blend.get("file")).toBeInstanceOf(File);
});
