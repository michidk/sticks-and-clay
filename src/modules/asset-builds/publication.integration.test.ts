import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { jobs } from "../../db/schema";
import { jobContext } from "../../lib/checkpoint.server";
import { bundleFiles } from "../../lib/source-bundle.server";
import { commitGeneratedBuild, readReceipt } from "./index.server";
import { committedDirectory } from "./publication.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
integration(
  "supervised publication commits a receipt and excludes retained generations from bundles",
  async () => {
    const id = crypto.randomUUID(),
      root = await mkdtemp(resolve(tmpdir(), "workshop-publication-"));
    await db
      .insert(jobs)
      .values({ id, kind: "presentation", targetId: id, status: "running" });
    try {
      await jobContext.run({ id, checkpoint: {} }, async () => {
        const candidate = resolve(root, ".candidate-fixture");
        await mkdir(candidate);
        await writeFile(
          resolve(candidate, "photography.json"),
          JSON.stringify({ images: {} }),
        );
        await commitGeneratedBuild(
          candidate,
          root,
          "photography",
          "fixture-source",
        );
        const generation = await committedDirectory(root);
        expect(generation).not.toBe(root);
        expect((await readReceipt(root)).inputHash).toBe("fixture-source");
        await writeFile(
          resolve(root, "photography.json"),
          "interrupted legacy alias",
        );
        expect(
          JSON.parse(
            await readFile(resolve(generation, "photography.json"), "utf8"),
          ),
        ).toEqual({ images: {} });
        const files = await bundleFiles(root);
        expect(files.some((file) => file.name.includes(".published"))).toBe(
          false,
        );
        expect(files.some((file) => file.name === "output-current.json")).toBe(
          false,
        );
      });
    } finally {
      await db.delete(jobs).where(eq(jobs.id, id));
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
