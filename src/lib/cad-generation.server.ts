import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../db/client";
import { runs } from "../db/schema";
import { roleInput, runRole } from "../modules/ai/index.server";
import { runExportProcess } from "../modules/asset-builds/index.server";
import { checkpoint, jobContext } from "./checkpoint.server";
import { DATA, getStorage, readStoredFile } from "./storage.server";
import { fileMimeType } from "./storage/path";
import { sourceZip } from "./source-bundle.server";
import type { AssetKind, Candidate } from "./reviewed-asset.server";
import { workshopContext } from "./workshop";
import { cadSpecResult } from "./cad";
import { assertJobActive } from "./queue.server";

const VIEWS = ["front", "rear", "left", "right", "top", "bottom", "iso"];
const python = () => process.env.CAD_PYTHON || resolve(process.platform === "win32" ? ".venv-cad/Scripts/python.exe" : ".venv-cad/bin/python");
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const upload = (key: string, bytes: Buffer | string) => getStorage().upload(new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], { type: fileMimeType(key) }), key);

export const cadKind: AssetKind = {
  format: "cad",
  judge: "cad-judge",
  async build(ctx, { node, previous, feedback }) {
    const { model, batch } = ctx;
    const job = jobContext.getStore();
    if (!job) throw new Error("Missing durable job context");
    const savedKey = `cad:candidate:${node.id}`;
    const directory = `cad/${model.id}/${ctx.attempt}/${node.iteration}`;
    // Publication can finish just before a process dies without writing its final checkpoint.
    if (!job.checkpoint[savedKey]) {
      const completed = await db.select().from(runs).where(and(eq(runs.modelId, model.id), eq(runs.role, "cad"), eq(runs.status, "done"), eq(runs.iteration, node.iteration)));
      const recovered = completed.map((run) => run.result as Candidate | null).find((candidate) => candidate?.exports?.manifest === `${directory}/output/manifest.json`);
      if (recovered) await checkpoint(savedKey, JSON.stringify(recovered));
    }
    if (job.checkpoint[savedKey]) {
      const candidate = JSON.parse(job.checkpoint[savedKey]) as Candidate;
      const manifest = JSON.parse(await (await readStoredFile(candidate.exports!.manifest)).text());
      if (hash(Buffer.from(await (await readStoredFile(candidate.exports!.script)).arrayBuffer())) !== manifest.sourceSha256) throw new Error("Saved CAD source checksum mismatch");
      for (const [file, digest] of Object.entries(manifest.files)) {
        const key = candidate.exports!.manifest.replace(/manifest\.json$/, file);
        if (hash(Buffer.from(await (await readStoredFile(key)).arrayBuffer())) !== digest) throw new Error("Saved CAD artifact checksum mismatch");
      }
      return candidate;
    }
    const root = resolve(DATA, directory); await mkdir(root, { recursive: true });
    // Support code is pinned on first execution, including on resume and in the source ZIP.
    const support = resolve(DATA, `cad/${model.id}/${ctx.attempt}/support`);
    if (!(await readFile(resolve(support, "runner.py")).then(() => true, () => false))) {
      const staged = support + "-" + crypto.randomUUID(); await mkdir(staged, { recursive: true });
      for (const file of ["runner.py", "cadcore.py", "render_views.py", "requirements.txt"]) await copyFile(resolve("cad", file), resolve(staged, file));
      await copyFile(resolve("blender/build_runtime.py"), resolve(staged, "build_runtime.py"));
      await rename(staged, support);
    }
    for (const file of ["runner.py", "cadcore.py", "render_views.py", "requirements.txt", "build_runtime.py"])
      if (!(await readFile(resolve(root, file)).then(() => true, () => false))) await copyFile(resolve(support, file), resolve(root, file));
    const starting = batch.workshop?.startingPoint;
    let source = "None";
    if (starting) {
      const bytes = Buffer.from(await (await readStoredFile(starting.key)).arrayBuffer());
      if (hash(bytes) !== starting.sha256) throw new Error("Starting point checksum mismatch");
      await writeFile(resolve(root, `starting.${starting.format}`), bytes);
      if (starting.format === "py") source = bytes.toString("utf8");
      else if (["step", "stp"].includes(starting.format)) {
        await writeFile(resolve(root, "input.step"), bytes);
        source = "Native STEP geometry is available as input.step. Import it and preserve unrelated geometry.";
      } else {
        source = `Reconstruct the supplied ${starting.format} mesh as CadQuery solids. Inspect its rendered evidence and preserve dimensional intent.`;
        if (starting.mesh) {
          await writeFile(resolve(root, "input.glb"), Buffer.from(await (await readStoredFile(starting.mesh)).arrayBuffer()));
          await runExportProcess(python(), [resolve("cad/inspect_mesh.py"), resolve(root, "input.glb")], root, 60_000);
          source += "\nMeasured original mesh bounds:\n" + await readFile(resolve(root, "process.log"), "utf8");
        }
      }
    }
    let previousScript = previous?.exports?.script ? await (await readStoredFile(previous.exports.script)).text() : "None";
    if (previous?.exports?.inputStep) await writeFile(resolve(root, "input.step"), Buffer.from(await (await readStoredFile(previous.exports.inputStep)).arrayBuffer()));
    if (previousScript === "None" && starting?.format === "py") previousScript = source;
    const spec = (await runRole({ role: "cad-spec", stepId: "cad:spec", projectId: model.projectId, batchId: batch.id, modelId: model.id,
      input: await roleInput("cad-spec", { design: batch.design, request: ctx.request + workshopContext(batch.workshop, false) }) })).result;
    await writeFile(resolve(root, "spec.json"), JSON.stringify(spec, null, 2));
    let problem = "None";
    for (let attempt = 0; attempt < 3; attempt++) {
      const failureKey = `cad:failure:${node.id}:${attempt}`;
      if (job.checkpoint[failureKey]) {
        const failure = JSON.parse(job.checkpoint[failureKey]); previousScript = failure.script; problem = failure.problem;
        continue;
      }
      const stepId = (node.iteration ? node.id : "cad") + (attempt ? `:fix${attempt}` : "");
      const { result, runId } = await runRole({ role: "cad", stepId, iteration: node.iteration, projectId: model.projectId, batchId: batch.id, modelId: model.id,
        input: await roleInput("cad", { design: batch.design, request: ctx.request + workshopContext(batch.workshop, false), spec: JSON.stringify(cadSpecResult.parse(spec)),
          source, previous: previousScript, feedback: feedback ? JSON.stringify(feedback) : "None", problem }),
        images: [...(previous?.previews.map((p) => p.key) ?? []), ...(starting?.views ?? (starting?.preview ? [starting.preview] : [])), ...ctx.references],
      });
      await writeFile(resolve(root, "asset.py"), result.script.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"));
      try {
        await runExportProcess(python(), [resolve(root, "runner.py"), "--blender", process.env.BLENDER_BIN || "blender"], root, 300_000);
      } catch (error) {
        await assertJobActive();
        const processFailure = JSON.parse(await readFile(resolve(root, "process-failure.json"), "utf8").catch(() => "{}"));
        if (["cancelled", "timeout", "dependency"].includes(processFailure.kind)) throw error;
        const failure = await readFile(resolve(root, "failure.json"), "utf8").catch(() => String(error));
        await db.update(runs).set({ result: { ...result, buildFailure: failure.slice(-12000) } }).where(eq(runs.id, runId));
        if (/No module named|ENOENT|CAD rendering failed|cancelled|timeout/i.test(failure)) throw error;
        await checkpoint(failureKey, JSON.stringify({ script: result.script, problem: failure.slice(-12000) }));
        if (attempt === 2) throw error;
        previousScript = result.script; problem = failure.slice(-12000); continue;
      }
      const metrics = JSON.parse(await readFile(resolve(root, "output/metrics.json"), "utf8"));
      if (previous?.analysis && typeof previous.analysis === "object" && "dimensionsMm" in previous.analysis) {
        const baseline = previous.analysis as { dimensionsMm: Record<string, number>; volumeMm3: number };
        metrics.previousComparison = { dimensionDeltaMm: Object.fromEntries(["x", "y", "z"].map((axis) => [axis, metrics.dimensionsMm[axis] - baseline.dimensionsMm[axis]])), volumeDeltaMm3: metrics.volumeMm3 - baseline.volumeMm3 };
      }
      const manifest = JSON.parse(await readFile(resolve(root, "output/manifest.json"), "utf8"));
      if (metrics.previousComparison) {
        const bytes = JSON.stringify(metrics, null, 2);
        await writeFile(resolve(root, "output/metrics.json"), bytes);
        manifest.files["metrics.json"] = hash(bytes);
        await writeFile(resolve(root, "output/manifest.json"), JSON.stringify(manifest, null, 2));
      }
      const exports: Record<string, string> = {};
      const bundle: { name: string; bytes: Uint8Array }[] = [];
      for (const name of [...Object.keys(manifest.files), "manifest.json"]) {
        const bytes = await readFile(resolve(root, "output", name));
        if (name !== "manifest.json" && hash(bytes) !== manifest.files[name]) throw new Error("CAD output checksum mismatch");
        const key = `${directory}/output/${name}`; await upload(key, bytes);
        bundle.push({ name: `output/${name}`, bytes });
        if (!name.endsWith(".png")) exports[name === "manifest.json" ? "manifest" : name.replace(/^asset\./, "").replace(/\.json$/, "")] = key;
      }
      for (const name of ["asset.py", "spec.json", "runner.py", "cadcore.py", "render_views.py", "build_runtime.py", "requirements.txt", ...(starting ? [`starting.${starting.format}`] : []),
        ...(await readFile(resolve(root, "input.step")).then(() => ["input.step"], () => [])),
        ...(await readFile(resolve(root, "input.glb")).then(() => ["input.glb"], () => []))]) {
        const bytes = await readFile(resolve(root, name)); bundle.push({ name, bytes });
        if (name === "asset.py" || name === "input.step") { const key = `${directory}/${name}`; await upload(key, bytes); exports[name === "asset.py" ? "script" : "inputStep"] = key; }
      }
      exports.source = `${directory}/source.zip`; await upload(exports.source, sourceZip(bundle));
      const candidate: Candidate = { key: `${directory}/output/iso.png`, exports,
        previews: VIEWS.map((view) => ({ key: `${directory}/output/${view}.png`, label: `actual exported CAD ${view} photograph; fixed orthographic scale` })),
        analysis: { ...metrics, spec }, requiredChecksPassed: metrics.checks.every((c: { required: boolean; state: string }) => !c.required || c.state === "passed") };
      await db.update(runs).set({ result: { ...result, ...candidate } }).where(eq(runs.id, runId));
      await checkpoint(savedKey, JSON.stringify(candidate));
      return candidate;
    }
    throw new Error("CAD build did not produce an artifact");
  },
};
