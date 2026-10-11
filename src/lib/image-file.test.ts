import { expect, test } from "bun:test";
import {
  appendReferenceImages,
  MAX_IMAGE_BYTES,
  validateImageFile,
  validateImageSelection,
} from "./image-file";

const png = new File(
  [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
  "reference.png",
  { type: "image/png" },
);
test("reference validation shares byte signatures and limits across intake methods", async () => {
  expect(await validateImageFile(png)).toBe("image/png");
  await expect(
    validateImageFile(
      new File(["not an image"], "spoof.png", { type: "image/png" }),
    ),
  ).rejects.toThrow("Use PNG");
  await expect(validateImageFile(new Blob([]))).rejects.toThrow("8 MB");
  await expect(
    validateImageFile(new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)])),
  ).rejects.toThrow("8 MB");
  await expect(validateImageSelection([png, png], 5)).rejects.toThrow(
    "up to 6",
  );
  await validateImageSelection([png], 5);
});
test("multipart state explicitly retains saved references and sends only new files", () => {
  const form = new FormData();
  appendReferenceImages(form, [
    {
      id: "saved",
      key: "references/saved.png",
      preview: "/api/files/references/saved.png",
      name: "Saved",
    },
    { id: "new", file: png, preview: "blob:new", name: png.name },
  ]);
  expect(JSON.parse(String(form.get("references")))).toEqual([
    "references/saved.png",
  ]);
  expect(form.getAll("images")).toHaveLength(1);
  appendReferenceImages(form, []);
  expect(form.get("references")).toBe("[]");
  expect(form.getAll("images")).toHaveLength(0);
});
