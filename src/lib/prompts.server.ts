import { readFile } from "node:fs/promises";
export async function prompt(
  name: string,
  values: Record<string, string | number>,
) {
  const template = await readFile(`prompts/${name}.md`, "utf8");
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in values)) throw new Error(`Missing prompt value: ${key}`);
    return String(values[key]);
  });
}
