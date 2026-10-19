import { imageProvider } from "./provider.server";
import {
  requestImage,
  type ImageSize,
  type ImageUsage,
} from "./image-api";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { runs, events } from "../../../db/schema";
import { imageRoleProfile } from "../config.server";
import type { imageRoles } from "../roles";
import { imagePrice, imagePricingSnapshot } from "./accounting.server";
import {
  DATA,
  filePath,
  readStoredFile,
  publishFiles,
} from "../../../lib/storage.server";

export type ImageInput = {
  role: keyof typeof imageRoles;
  name: string;
  prompt: string;
  size?: ImageSize;
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
  const profile = await imageRoleProfile(args.role);
  if (!(
    /^models\/[0-9a-f-]+\/[0-9a-f-]+\/(concept|iteration-\d+\/textures)$/.test(
      args.directory,
    ) ||
    /^(graphics|mockups)\/[0-9a-f-]+\/[0-9a-f-]+$/.test(args.directory)
  ))
    throw new Error("Invalid image workspace");
  await mkdir(resolve(DATA, args.directory), { recursive: true });
  const textureDir = await filePath(args.directory);
  const references = await Promise.all(
    (args.images || []).map(async (key, index) => {
      const image = await readStoredFile(key);
      return new File(
        [await image.arrayBuffer()],
        `reference-${index}.${image.type === "image/jpeg" ? "jpg" : image.type === "image/webp" ? "webp" : "png"}`,
        { type: image.type },
      );
    }),
  );
  // Prompt identity makes tool retries reusable without overwriting a different image.
  const digest = createHash("sha256")
    .update(JSON.stringify([args.prompt, args.images || [], args.size]))
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
  const rates = imagePricingSnapshot(profile.model);
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
    model: profile.model,
    effort: profile.quality,
    systemPrompt: `Image API · ${args.size || "1024x1024"} · ${profile.quality} quality · ${profile.settings.imageProvider === "openai" ? "OpenAI API" : "gateway"}`,
    promptVersion: "image-api-v3",
    input: args.prompt,
    rates,
  });
  const controller = new AbortController();
  let usage: ImageUsage | undefined;
  const timer = setTimeout(() => controller.abort(), profile.settings.timeouts.imageMs);
  const monitor = setInterval(() => {
    void args.assertActive().catch(() => controller.abort());
  }, 500);
  try {
    const response = await requestImage({
      provider: await imageProvider(profile.settings.imageProvider),
      model: profile.model,
      quality: profile.quality,
      size: args.size,
      prompt: args.prompt,
      references,
      signal: controller.signal,
    });
    usage = response.usage;
    await args.assertActive();
    if (controller.signal.aborted)
      throw new Error("Image generation cancelled or timed out");
    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) throw new Error("Image API returned no image data");
    const png = Buffer.from(encoded, "base64");
    if (
      !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("Image API did not produce a PNG");
    await writeFile(resolve(textureDir, filename), png);
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
  } catch (caught) {
    const error = controller.signal.aborted
      ? new Error("Image generation cancelled or timed out")
      : caught;
    await db
      .update(runs)
      .set({ status: "failed", error: String(error), finishedAt: new Date() })
      .where(eq(runs.id, id));
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(monitor);
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
          estimatedCost: imagePrice(usage, rates),
        })
        .where(eq(runs.id, id));
    }
  }
}
