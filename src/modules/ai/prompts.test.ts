import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { constructionGuides } from "../../lib/workshop";
import { imageRoles, roles } from "./roles";

// Prompts that are not model input: documentation, evaluation controls and licences.
const notInput = (file: string) =>
  file === "README" || file.startsWith("licenses/") || file.startsWith("evaluations/") ||
  ["references/SOURCES", "references/WORKSHOP-INSPIRATION"].includes(file);

test("every prompt file is used by a role or a prompt() call, and every named prompt exists", () => {
  const used = new Set<string>([
    "eve/system", "eve/resume", "models/modeling-pass", "models/modeling-review",
    "references/sprite-target",
    ...constructionGuides("organic tree modular grip sprite", "complete"),
  ]);
  for (const definition of [...Object.values(roles), ...Object.values(imageRoles)]) {
    used.add(definition.prompt);
    used.add(definition.inputTemplate);
    if ("references" in definition) definition.references.forEach((name) => used.add(name));
  }
  const files = readdirSync("prompts", { recursive: true })
    .map((file) => String(file).replaceAll("\\", "/"))
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3))
    .filter((file) => !notInput(file));
  expect(files.filter((file) => !used.has(file))).toEqual([]);
  expect([...used].filter((name) => !files.includes(name))).toEqual([]);
});
