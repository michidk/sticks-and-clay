import { z } from "zod";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { jobs, runs, events } from "../../db/schema";
import { DATA, filePath } from "../../lib/storage.server";

export const textureRequest = z.object({
  capability: z.string().uuid(),
  name: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  prompt: z.string().min(20).max(8000),
});
const active = new Map<string, Promise<unknown>>();
export async function generateTexture(args: z.infer<typeof textureRequest>) {
  const key = JSON.stringify(args);
  const existing = active.get(key);
  if (existing) return existing;
  const work = createTexture(args).finally(() => active.delete(key));
  active.set(key, work);
  return work;
}
async function createTexture(args: z.infer<typeof textureRequest>) {
  const marker = resolve(DATA, "capabilities", args.capability + ".json");
  const authorization = JSON.parse(await readFile(marker, "utf8"));
  if (authorization.cancelled) throw new Error("Build cancelled");
  const match = /^models\/([^/]+)\/([^/]+)\/iteration-(\d+)$/.exec(
    authorization.directory,
  );
  if (!match) throw new Error("Unsupported builder workspace");
  const [, modelId, attempt, iteration] = match;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, attempt));
  if (!job || job.status !== "running")
    throw new Error("Builder job is not running");
  const builderId = job.checkpoint[`agent:builder:${iteration}`];
  const [builder] = builderId
    ? await db.select().from(runs).where(eq(runs.id, builderId))
    : [];
  if (!builder || builder.role !== "builder" || builder.modelId !== modelId)
    throw new Error("Missing authorized builder run");
  const directory = await filePath(authorization.directory);
  const textureDir = resolve(directory, "textures");
  await mkdir(textureDir, { recursive: true });
  // Prompt identity makes tool retries reusable without overwriting a different image.
  const digest = createHash("sha256")
    .update(args.prompt)
    .digest("hex")
    .slice(0, 16);
  const filename = `${args.name}-${digest}.png`;
  const receipt = resolve(textureDir, filename + ".json");
  try {
    const saved = JSON.parse(await readFile(receipt, "utf8"));
    await readFile(resolve(textureDir, filename));
    return saved;
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
  const id = crypto.randomUUID();
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
  await db
    .insert(runs)
    .values({
      id,
      projectId: builder.projectId,
      batchId: builder.batchId,
      modelId,
      iteration: Number(iteration),
      role: "texture",
      engine: "imagegen",
      model: "gpt-image-2",
      systemPrompt: "Codex imagegen skill CLI · 1024x1024 · medium quality",
      promptVersion: "imagegen-v1",
      input: args.prompt,
      rates,
    });
  let cancelled = false;
  try {
    await new Promise<void>((done, reject) => {
      const python =
        process.env.STUDIO_IMAGEGEN_PYTHON ||
        "/tmp/asset-studio-imagegen/bin/python";
      const child = spawn(
        "python3",
        [
          "scripts/provider.py",
          python,
          "scripts/imagegen_texture.py",
          usageFile,
          "generate",
          "--model",
          "gpt-image-2",
          "--prompt",
          args.prompt,
          "--size",
          "1024x1024",
          "--quality",
          "medium",
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
        void readFile(marker, "utf8")
          .then((raw) => {
            if (JSON.parse(raw).cancelled) {
              cancelled = true;
              child.kill("SIGKILL");
            }
          })
          .catch(() => {
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
                  ? "Texture generation cancelled or timed out"
                  : "Codex imagegen CLI failed; check skill and provider configuration",
              ),
            );
      });
    });
    const png = await readFile(resolve(textureDir, filename));
    if (
      !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("Imagegen did not produce a PNG");
    const result = {
      path: resolve(textureDir, filename),
      key: `${authorization.directory}/textures/${filename}`,
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
      await db
        .insert(events)
        .values({
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
