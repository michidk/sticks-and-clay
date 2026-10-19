import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const privateDirectories = new Set([
  "node_modules",
  "data",
  "output",
  ".output",
  "dist",
  "coverage",
  ".cache",
  ".npm",
  ".venv",
  ".ruff_cache",
  "__pycache__",
  ".codex",
  ".claude",
  ".serena",
  ".agents",
  ".gitnexus",
]);

test("the tracked repository excludes private state and generated runtime files", () => {
  const forbidden = files.filter((file) => {
    const parts = file.split("/");
    const name = parts.at(-1) ?? "";
    const materialFixture = /^demo\/files\/materials\/[^/]+\/output\/(?:build-receipt|calibration|manifest|material)\.json$/.test(file);
    return (
      parts.some((part) => privateDirectories.has(part) && !(part === "output" && materialFixture)) ||
      (name.startsWith(".env") && file !== ".env.example") ||
      /\.(?:pem|key|p12|pfx|log|pyc|bak|tmp)$/.test(name) ||
      /\.local\.[^.]+$/.test(name) ||
      name === ".DS_Store" ||
      file.startsWith("eve/.eve/")
    );
  });
  expect(forbidden).toEqual([]);
});

test("local Markdown links resolve to existing repository files", () => {
  const broken: string[] = [];
  for (const file of files.filter(
    (file) => file.endsWith(".md") && existsSync(file),
  )) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = (match[1] ?? "").split(/\s+"/)[0].split("#")[0];
      if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      if (!existsSync(resolve(dirname(file), decodeURIComponent(target))))
        broken.push(`${file}: ${target}`);
    }
  }
  expect(broken).toEqual([]);
});
