import { readFile } from "node:fs/promises";
import { roles, type Role } from "../roles";

/** Snapshot the complete instruction bundle; resumed sessions keep the saved text. */
export async function roleInstructions(role: Role, saved?: string | null) {
  if (saved != null) return saved;
  const definition = roles[role];
  const sections = await Promise.all(
    [definition.prompt, ...definition.references].map((name) =>
      readFile(`prompts/${name}.md`, "utf8"),
    ),
  );
  return sections.join("\n\n");
}
