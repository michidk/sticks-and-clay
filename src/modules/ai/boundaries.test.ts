import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("AI adapter internals are accessed only through the public module", async () => {
  for await (const file of new Bun.Glob("src/**/*.{ts,tsx}").scan(".")) {
    if (file.startsWith("src/modules/ai/")) continue;
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\()["']([^"']+)["']/g,
    )) {
      const target = resolve(file, "..", match[1]);
      expect(target.startsWith(resolve("src/modules/ai/internal"))).toBe(false);
    }
  }
});
