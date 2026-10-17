import { and, eq } from "drizzle-orm";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { materialAssignmentInput } from "../../lib/api-inputs";
import { db } from "../../db/client";
import { jobs, assetVersions } from "../../db/schema";
import { checkpointMany, jobContext } from "../../lib/checkpoint.server";
import { DATA, publishFiles } from "../../lib/storage.server";
import { assertJobActive } from "../../lib/queue.server";
import {
  exportBundle,
  runExportProcess,
  readReceipt,
} from "../asset-builds/index.server";

export async function createAssignment(modelId: string, value: unknown) {
  const input = materialAssignmentInput.parse(value);
  const [model] = await db
    .select()
    .from(assetVersions)
    .where(eq(assetVersions.id, z.string().uuid().parse(modelId)));
  const [material] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.id, input.materialVersionId),
        eq(jobs.kind, "material"),
        eq(jobs.status, "done"),
      ),
    );
  if (
    !model?.artifacts?.glb ||
    !material ||
    material.targetId !== model.projectId
  )
    throw new Error("Choose completed assets from the same collection");
  const sourceKey = z.string().parse(model.artifacts.glb);
  const source = await readFile(resolve(DATA, sourceKey));
  const document = JSON.parse(
    source.toString("utf8", 20, 20 + source.readUInt32LE(12)),
  );
  if (
    !document.materials?.some((m: { name?: string }) => m.name === input.slot)
  )
    throw new Error("Choose an existing named material slot");
  const slotIndex = document.materials.findIndex(
    (m: { name?: string }) => m.name === input.slot,
  );
  if (
    document.meshes?.some(
      (m: {
        primitives: { material?: number; attributes: Record<string, number> }[];
      }) =>
        m.primitives.some(
          (p) =>
            p.material === slotIndex && p.attributes.TEXCOORD_0 === undefined,
        ),
    )
  )
    throw new Error(
      "Selected material slot includes a mesh without UV coordinates",
    );
  const id = crypto.randomUUID();
  const materialFiles = z
    .array(z.string())
    .parse(JSON.parse(material.checkpoint.files));
  const mapHashes: Record<string, string> = {};
  for (const name of [
    "albedo",
    "normal",
    "roughness",
    "metallic",
    "height",
    "ao",
  ]) {
    const key = materialFiles.find((file) =>
      file.endsWith(`/output/${name}.png`),
    );
    if (!key) throw new Error(`Missing ${name} map`);
    mapHashes[name] = createHash("sha256")
      .update(await readFile(resolve(DATA, key)))
      .digest("hex");
  }
  await db.insert(jobs).values({
    id,
    kind: "material-assignment",
    targetId: model.id,
    checkpoint: {
      parameters: JSON.stringify(input),
      source: sourceKey,
      sourceHash: createHash("sha256").update(source).digest("hex"),
      materialFiles: material.checkpoint.files,
      mapHashes: JSON.stringify(mapHashes),
    },
  });
  return { id };
}

export async function renderAssignment() {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing assignment job");
  const directory = `assignments/${job.id}`,
    root = resolve(DATA, directory);
  await mkdir(resolve(root, "maps"), { recursive: true });
  const params = JSON.parse(job.checkpoint.parameters);
  if (job.checkpoint.prepared !== "yes") {
    const source = await readFile(resolve(DATA, job.checkpoint.source));
    if (
      createHash("sha256").update(source).digest("hex") !==
      job.checkpoint.sourceHash
    )
      throw new Error("Source version changed");
    await writeFile(resolve(root, "source.glb"), source);
    const files = z
      .array(z.string())
      .parse(JSON.parse(job.checkpoint.materialFiles));
    for (const name of [
      "albedo",
      "normal",
      "roughness",
      "metallic",
      "height",
      "ao",
    ]) {
      const key = files.find((f) => f.endsWith(`/output/${name}.png`));
      if (!key) throw new Error(`Missing ${name} map`);
      const map = await readFile(resolve(DATA, key));
      const expected = job.checkpoint.mapHashes
        ? JSON.parse(job.checkpoint.mapHashes)[name]
        : undefined;
      if (
        expected &&
        createHash("sha256").update(map).digest("hex") !== expected
      )
        throw new Error(`Saved ${name} map changed`);
      await writeFile(resolve(root, "maps", `${name}.png`), map);
    }
    for (const name of [
      "assign_material.py",
      "build_runtime.py",
      "build_artifacts.py",
    ])
      await copyFile(resolve("blender", name), resolve(root, name));
    await writeFile(
      resolve(root, "params.json"),
      JSON.stringify(params, null, 2),
    );
    await writeFile(
      resolve(root, "render.py"),
      `import argparse, pathlib\nfrom build_runtime import launch\np=argparse.ArgumentParser();p.add_argument('--blender',default='blender');a=p.parse_args()\nr=pathlib.Path(__file__).resolve().parent\nraise SystemExit(launch([a.blender,'-b','--factory-startup','--python-exit-code','1','--python',str(r/'assign_material.py')],str(r),900))\n`,
    );
    await checkpointMany({ prepared: "yes" });
  }
  await runExportProcess(
    process.env.BLENDER_BIN || "blender",
    [
      "-b",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "--python",
      resolve(root, "assign_material.py"),
    ],
    root,
    900000,
  );
  const provenance = JSON.parse(
    await readFile(resolve(root, "assignment.json"), "utf8"),
  );
  if (provenance.sourceSha256 !== job.checkpoint.sourceHash)
    throw new Error("Assignment source mismatch");
  const hasReceipt = await readFile(resolve(root, "build-receipt.json")).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
  if (hasReceipt) await readReceipt(root);
  await exportBundle(directory);
  const files = [
    "derived.glb",
    "assignment.json",
    ...(hasReceipt ? ["build-receipt.json"] : []),
    "source.zip",
    "delivery.zip",
    "build-manifest.json",
  ].map((n) => `${directory}/${n}`);
  await assertJobActive();
  await publishFiles(files);
  await checkpointMany({ files: JSON.stringify(files), applied: "yes" });
}
