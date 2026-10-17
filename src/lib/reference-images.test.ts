import { test, expect } from "bun:test";
import { prepareReferences } from "./reference-images.server";

test("draft references can be retained, removed entirely, or preserved by a legacy caller", async () => {
  const saved = ["references/one.png", "references/two.jpg"];
  const form = new FormData();
  expect((await prepareReferences(form, saved)).references).toEqual(saved);
  form.set("references", JSON.stringify([saved[1]]));
  expect((await prepareReferences(form, saved)).references).toEqual([saved[1]]);
  form.set("references", "[]");
  expect((await prepareReferences(form, saved)).references).toEqual([]);
});
test("drafts cannot attach another project's files or exceed the total reference limit", async () => {
  const form = new FormData();
  form.set("references", '["references/foreign.png"]');
  await expect(prepareReferences(form, ["references/own.png"])).rejects.toThrow(
    "this draft",
  );
  form.set("references", '["references/own.png","references/own.png"]');
  await expect(prepareReferences(form, ["references/own.png"])).rejects.toThrow(
    "this draft",
  );
  form.set(
    "references",
    JSON.stringify(Array.from({ length: 6 }, (_, i) => `references/${i}.png`)),
  );
  form.append("images", new File(["bad"], "extra.png"));
  await expect(
    prepareReferences(form, JSON.parse(String(form.get("references")))),
  ).rejects.toThrow("up to 6");
});

test("an explicitly selected empty file is rejected rather than silently removed", async () => {
  const form = new FormData();
  form.append("images", new File([], "empty.png", { type: "image/png" }));
  await expect(prepareReferences(form)).rejects.toThrow("1 byte and 8 MB");
});

test("reference notes are trimmed, capped and dropped with their image", async () => {
  const { retainedNotes } = await import("./reference-images.server");
  expect(retainedNotes({ a: "  keep ", b: "gone", c: "x".repeat(1500), d: " " }, ["a", "c", "d"])).toEqual({
    a: "keep",
    c: "x".repeat(1000),
  });
});
