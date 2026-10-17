import { z } from "zod";
import { validateImageSelection } from "./image-file";
import { getStorage, upload } from "./storage.server";

// Explicit references (including []) let a draft remove its final image.
// Older multipart callers retain saved references when they send no image fields.
export async function prepareReferences(
  form: FormData,
  saved: readonly string[] = [],
) {
  const files = form
    .getAll("images")
    .filter(
      (value): value is File =>
        value instanceof File && (value.size > 0 || value.name !== ""),
    );
  const explicit = form.has("references");
  const retained = explicit
    ? z
        .array(z.string())
        .max(6)
        .parse(JSON.parse(String(form.get("references"))))
    : files.length
      ? []
      : [...saved];
  if (
    new Set(retained).size !== retained.length ||
    retained.some((key) => !saved.includes(key))
  ) {
    throw new Error("Only this draft's saved references can be retained");
  }
  await validateImageSelection(files, retained.length);
  const uploaded: string[] = [];
  try {
    for (const file of files) uploaded.push(await upload(file));
  } catch (error) {
    await Promise.allSettled(uploaded.map((key) => getStorage().delete(key)));
    throw error;
  }
  return {
    references: [...retained, ...uploaded],
    rollback: () =>
      Promise.allSettled(uploaded.map((key) => getStorage().delete(key))),
  };
}

/** The owner's notes for the references that remain, trimmed and capped. */
export function retainedNotes(notes: unknown, references: readonly string[]) {
  const parsed = z.record(z.string(), z.string()).parse(notes);
  return Object.fromEntries(
    references.flatMap((key) => (parsed[key]?.trim() ? [[key, parsed[key].trim().slice(0, 1000)]] : [])),
  );
}
