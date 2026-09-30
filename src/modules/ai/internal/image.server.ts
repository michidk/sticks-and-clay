import { constants } from "node:fs";
import { access, readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { runs, events } from "../../../db/schema";
import { imageRoles } from "../roles";
import {
  DATA,
  filePath,
  readStoredFile,
  publishFiles,
} from "../../../lib/storage.server";

export type ImageInput = {
  role: "texture" | "visual-target";
  name: string;
  prompt: string;
  directory: string;
  projectId: string;
  batchId?: string | null;
  modelId?: string;
  iteration?: number;
  stepId?: string;
  images?: string[];
  assertActive: () => Promise<void>;
};
export async function imageRequest(
  args: ImageInput,
): Promise<{ path: string; key: string; runId: string; name: string }> {
  await args.assertActive();
  if (
    !/^models\/[0-9a-f-]+\/[0-9a-f-]+\/(concept|iteration-\d+\/textures)$/.test(
      args.directory,
    )
  )
    throw new Error("Invalid image workspace");
  await mkdir(resolve(DATA, args.directory), { recursive: true });
  const textureDir = await filePath(args.directory);
  const referencePaths = await Promise.all(
    (args.images || []).map(async (key, index) => {
      const image = await readStoredFile(key);
      const path = resolve(
        textureDir,
        `reference-${index}.${image.type === "image/jpeg" ? "jpg" : image.type === "image/webp" ? "webp" : "png"}`,
      );
      await writeFile(path, Buffer.from(await image.arrayBuffer()));
      return path;
    }),
  );
  // Prompt identity makes tool retries reusable without overwriting a different image.
  const digest = createHash("sha256")
    .update(JSON.stringify([args.prompt, args.images || []]))
    .digest("hex")
    .slice(0, 16);
  const identity = `${args.name}-${digest}.png`;
  const receipt = resolve(textureDir, identity + ".json");
  try {
    const saved = JSON.parse(await readFile(receipt, "utf8"));
    await readFile(saved.path);
    return saved;
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  await args.assertActive();
  const stepId = `${args.stepId || "image"}:${args.directory}/${identity}`;
  const previousRuns = await db
    .select()
    .from(runs)
    .where(and(eq(runs.projectId, args.projectId), eq(runs.stepId, stepId)));
  for (const previous of previousRuns) {
    if (previous.status === "done" && previous.result) {
      const saved = previous.result as {
        path: string;
        key: string;
        runId: string;
        name: string;
      };
      await readFile(saved.path);
      await publishFiles([saved.key]);
      await writeFile(receipt, JSON.stringify(saved));
      return saved;
    }
    if (previous.status === "running")
      await db
        .update(runs)
        .set({
          status: "failed",
          error:
            "Image request interrupted; one-shot request cannot resume. Retry recorded separately.",
          finishedAt: new Date(),
        })
        .where(eq(runs.id, previous.id));
  }
  const id = crypto.randomUUID();
  // Interrupted requests can still finish at the provider; never share their output file.
  const filename = `${args.name}-${digest}-${id}.png`;
  const usageFile = resolve(textureDir, `${id}-usage.json`);
  const rates = {
    input: Number(process.env.IMAGE_INPUT_USD_PER_MILLION || 0),
    cached: 0,
    output: Number(process.env.IMAGE_OUTPUT_USD_PER_MILLION || 0),
    source:
      "Operator image-token rate assumption; unset means cost unavailable",
  };
  if ([rates.input, rates.output].some((n) => !Number.isFinite(n) || n < 0))
    throw new Error("Invalid image rates");
  await db.insert(runs).values({
    id,
    projectId: args.projectId,
    batchId: args.batchId,
    modelId: args.modelId,
    iteration: args.iteration || 0,
    role: args.role,
    stepId,
    images: args.images || [],
    engine: "imagegen",
    model: imageRoles[args.role].model,
    systemPrompt: `Codex imagegen skill CLI · 1024x1024 · ${imageRoles[args.role].quality} quality`,
    promptVersion: "imagegen-v1",
    input: args.prompt,
    rates,
  });
  let cancelled = false;
  try {
    const python =
      process.env.STUDIO_IMAGEGEN_PYTHON ||
      resolve(".venv-imagegen/bin/python");
    await access(python, constants.X_OK).catch(() => {
      throw new Error(
        "Image generation Python environment is missing. Install the imagegen prerequisites in README.md and restart the worker.",
      );
    });
    await new Promise<void>((done, reject) => {
      const child = spawn(
        "python3",
        [
          "scripts/provider.py",
          python,
          "scripts/imagegen_texture.py",
          usageFile,
          ...(args.images?.length
            ? ["edit", ...referencePaths.flatMap((path) => ["--image", path])]
            : ["generate"]),
          "--model",
          imageRoles[args.role].model,
          "--prompt",
          args.prompt,
          "--size",
          "1024x1024",
          "--quality",
          imageRoles[args.role].quality,
          "--out",
          resolve(textureDir, filename),
          "--force",
        ],
        { cwd: process.cwd(), stdio: "ignore" },
      );
      const timer = setTimeout(() => {
        cancelled = true;
        child.kill("SIGKILL");
      }, 240000);
      const monitor = setInterval(() => {
        void args.assertActive().catch(() => {
          cancelled = true;
          child.kill("SIGKILL");
        });
      }, 500);
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(monitor);
      };
      child.once("error", (error) => {
        cleanup();
        reject(error);
      });
      child.once("close", (code) => {
        cleanup();
        code === 0 && !cancelled
          ? done()
          : reject(
              new Error(
                cancelled
                  ? "Image generation cancelled or timed out"
                  : "Codex imagegen CLI failed; check skill and provider configuration",
              ),
            );
      });
    });
    await args.assertActive();
    const png = await readFile(resolve(textureDir, filename));
    if (
      !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("Imagegen did not produce a PNG");
    const result = {
      path: resolve(textureDir, filename),
      key: `${args.directory}/${filename}`,
      runId: id,
      name: args.name,
    };
    await db
      .update(runs)
      .set({
        status: "done",
        result,
        output: JSON.stringify(result),
        finishedAt: new Date(),
      })
      .where(eq(runs.id, id));
    await publishFiles([result.key]);
    await writeFile(receipt, JSON.stringify(result));
    return result;
  } catch (error) {
    await db
      .update(runs)
      .set({ status: "failed", error: String(error), finishedAt: new Date() })
      .where(eq(runs.id, id));
    throw error;
  } finally {
    let usage: any = null;
    try {
      usage = JSON.parse(await readFile(usageFile, "utf8"));
    } catch {}
    if (usage) {
      await db.insert(events).values({
        id: crypto.randomUUID(),
        runId: id,
        type: "image.usage",
        payload: usage,
      });
      const input = usage.input_tokens || 0,
        output = usage.output_tokens || 0;
      await db
        .update(runs)
        .set({
          inputTokens: input,
          outputTokens: output,
          usageSource: "reported",
          estimatedCost:
            process.env.IMAGE_INPUT_USD_PER_MILLION &&
            process.env.IMAGE_OUTPUT_USD_PER_MILLION
              ? (input * rates.input + output * rates.output) / 1e6
              : null,
        })
        .where(eq(runs.id, id));
    }
  }
}
