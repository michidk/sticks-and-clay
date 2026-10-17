import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { runRole, roleInput } from "../modules/ai/index.server";
import { assertJobActive } from "./queue.server";
import { getStorage, readStoredFile } from "./storage.server";
import { validateSvg } from "./svg";

export async function generateSvg(args: {
  projectId: string;
  batchId: string;
  modelId: string;
  directory: string;
  design: string;
  name: string;
  request: string;
  size: string;
  images: string[];
}) {
  const source = await Promise.all(
    args.images
      .filter((key) => key.endsWith(".svg"))
      .map(async (key) => (await readStoredFile(key)).text()),
  );
  const { result, runId } = await runRole({
    role: "svg",
    stepId: "svg",
    projectId: args.projectId,
    batchId: args.batchId,
    modelId: args.modelId,
    input: await roleInput("svg", {
      design: args.design,
      name: args.name,
      request: args.request,
      size: args.size,
      source: source.join("\n\n"),
    }),
    images: args.images.filter((key) => !key.endsWith(".svg")),
  });
  let svg: string;
  try {
    svg = validateSvg(result.svg);
  } catch (error) {
    await db
      .update(runs)
      .set({ status: "failed", error: String(error) })
      .where(eq(runs.id, runId));
    throw error;
  }
  await assertJobActive();
  const key = `${args.directory}/graphic.svg`;
  await getStorage().upload(new Blob([svg], { type: "image/svg+xml" }), key);
  await db
    .update(runs)
    .set({ result: { ...result, key } })
    .where(eq(runs.id, runId));
  return { key };
}
