import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

test("views show compressed previews: no <img> is given an original file URL", () => {
  const offenders = (readdirSync("src", { recursive: true }) as string[])
    .filter((file) => file.endsWith(".tsx"))
    .flatMap((file) =>
      [...readFileSync(resolve("src", file), "utf8").matchAll(/<img\b[\s\S]*?\/>/g)]
        // `?w=` / previewUrl select the compressed copy; AssetImage adds it itself and is not an <img>.
        .filter(([tag]) => /fileUrl\(/.test(tag) && !/previewUrl\(|\?w=/.test(tag))
        .map(() => file),
    );
  expect(offenders).toEqual([]);
});
