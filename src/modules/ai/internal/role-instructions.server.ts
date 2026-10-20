import { readFile } from "node:fs/promises";
import { roles, type Role } from "../roles";
import { constructionGuides } from "../../../lib/workshop";

/** Snapshot the complete instruction bundle; resumed sessions keep the saved text. */
export async function roleInstructions(
  role: Role,
  saved?: string | null,
  construction?: {
    request: string;
    stage: string;
    outputTarget?: "model" | "sprite";
  },
  guides?: readonly string[],
) {
  if (saved != null) return saved;
  const definition = roles[role];
  const sections = await Promise.all(
    [
      definition.prompt,
      ...(role === "builder" && construction
        ? constructionGuides(construction.request, construction.stage)
        : (guides ?? definition.references)),
      ...(construction?.outputTarget === "sprite"
        ? ["references/sprite-target"]
        : []),
    ].map((name) => readFile(`prompts/${name}.md`, "utf8")),
  );
  return sections.join("\n\n");
}
