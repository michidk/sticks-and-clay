/** Standalone, resumable paired pilot. Never run inside the web/worker process. */
import { cp, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { jobs, projects, runs } from "../src/db/schema";
import { DATA } from "../src/lib/storage.server";
import { materialAction, renderMaterial } from "../src/lib/materials.server";
import { jobContext } from "../src/lib/checkpoint.server";

const repository = resolve(import.meta.dir, ".."),
  output = resolve(process.argv[2] || "");
if (
  !process.argv[2] ||
  !process.env.STUDIO_DATA_DIR ||
  !process.env.STUDIO_PYTHON
)
  throw new Error(
    "Usage: STUDIO_DATA_DIR=isolated-data STUDIO_PYTHON=absolute-python bun scripts/evaluate-material-prompts.ts OUTPUT_DIRECTORY [--run]",
  );
const execute = process.argv.includes("--run");
const cases = [
  {
    id: "gravel",
    recipe: "gravel",
    features: ["F1", "F2", "F3"],
    brief:
      "Stylized gray gravel. F1: visibly larger partially buried stones over fine grains. F2: sparse darker dirt in the gaps, with coherent roughness and relief. F3: a quiet gray palette with no decorative stripes.",
  },
  {
    id: "wood",
    recipe: "wood",
    features: ["F1", "F2", "F3"],
    brief:
      "Warm brown wooden boards. F1: distinct board boundaries. F2: knots that bend surrounding grain. F3: restrained darker dirt along board gaps without a global color wash.",
  },
  {
    id: "paint",
    recipe: "painted_metal",
    features: ["F1", "F2", "F3"],
    brief:
      "Quiet sage painted steel. F1: sparse chips exposing metallic substrate. F2: a few thin scratches that expose the same substrate. F3: intact paint stays dielectric, with no extra ornament.",
  },
] as const;
const selectedCase = process.argv
  .find((arg) => arg.startsWith("--case="))
  ?.split("=")[1];
const selectedVariant = process.argv
  .find((arg) => arg.startsWith("--variant="))
  ?.split("=")[1];
if (selectedCase && !cases.some((item) => item.id === selectedCase))
  throw new Error("Unknown case");
if (selectedVariant && !["control", "full"].includes(selectedVariant))
  throw new Error("Unknown variant");
const file = resolve(output, "evaluation.json");
await mkdir(output, { recursive: true });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
let manifest = await readFile(file, "utf8")
  .then(JSON.parse)
  .catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
if (!manifest) {
  manifest = {
    version: 1,
    projectId: crypto.randomUUID(),
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim(),
    runtimeSourceHashes: Object.fromEntries(
      await Promise.all(
        [
          "scripts/evaluate-material-prompts.ts",
          "src/lib/materials.ts",
          "src/modules/materials/review.server.ts",
          "src/modules/ai/internal/tanstack.server.ts",
          "src/modules/ai/internal/role-instructions.server.ts",
        ].map(async (name) => [
          name,
          hash(await readFile(resolve(repository, name), "utf8")),
        ]),
      ),
    ),
    limits:
      "Up to three paired briefs (see cases/variants for selected scope), one construction seed per brief, no external reference images. Experimental ablated control, not a historical production baseline. Same model configuration, toolkit, final resolution and upper call budgets; early passing stops naturally. Small pilot, no statistical significance claim.",
    seed: 17,
    size: 256,
    reviewRounds: 2,
    maxRuntimeRepairsPerBuild: 2,
    cases: cases.filter((item) => !selectedCase || item.id === selectedCase),
    variants: {},
    trials: [],
  };
  for (const variant of ["control", "full"].filter(
    (name) => !selectedVariant || name === selectedVariant,
  )) {
    const workspace = resolve(output, variant);
    await mkdir(resolve(workspace, "blender"), { recursive: true });
    await cp(resolve(repository, "prompts"), resolve(workspace, "prompts"), {
      recursive: true,
    });
    await cp(
      resolve(repository, "blender/materials"),
      resolve(workspace, "blender/materials"),
      { recursive: true, filter: (path) => !path.includes("__pycache__") },
    );
    for (const name of ["build_runtime.py", "build_artifacts.py"])
      await copyFile(
        resolve(repository, "blender", name),
        resolve(workspace, "blender", name),
      );
    if (variant === "control")
      await copyFile(
        resolve(repository, "prompts/evaluations/material-builder-control.md"),
        resolve(workspace, "prompts/materials/material-builder.md"),
      );
    manifest.variants[variant] = {
      workspace,
      promptSha256: hash(
        await readFile(
          resolve(workspace, "prompts/materials/material-builder.md"),
          "utf8",
        ),
      ),
      guideSha256: hash(
        await readFile(
          resolve(workspace, "prompts/references/material-construction.md"),
          "utf8",
        ),
      ),
    };
  }
  await writeFile(file, JSON.stringify(manifest, null, 2));
}
if (!execute) {
  console.log(
    "Prepared paired pilot",
    file,
    "(no AI calls). Add --run with configured provider to execute.",
  );
  process.exit(0);
}
const persist = () => writeFile(file, JSON.stringify(manifest, null, 2));
await db
  .insert(projects)
  .values({
    id: manifest.projectId,
    name: "Material prompt paired pilot",
    description: "Controlled evaluation",
    design:
      "Quiet stylized game materials. Keep physical scale and coherent PBR channels.",
    status: "ready",
  })
  .onConflictDoNothing();
trials: for (const item of manifest.cases as typeof cases)
  for (const variant of Object.keys(manifest.variants)) {
    let trial = manifest.trials.find(
      (entry: any) => entry.caseId === item.id && entry.variant === variant,
    );
    if (trial?.status === "done") continue;
    process.chdir(manifest.variants[variant].workspace);
    if (!trial) {
      const response = await materialAction(
        new Request(
          `http://localhost/api/projects/${manifest.projectId}/materials`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              parameters: {
                recipe: item.recipe,
                seed: manifest.seed,
                size: manifest.size,
                featureMm: 80,
                tileMetres: 1,
                calibration: 0,
              },
              prompt: item.brief,
              reviewRounds: manifest.reviewRounds,
            }),
          },
        ),
        ["projects", manifest.projectId, "materials"],
      );
      const { id } = await response!.json();
      trial = {
        caseId: item.id,
        variant,
        jobId: id,
        status: "pending",
        seconds: 0,
      };
      manifest.trials.push(trial);
      await persist();
    }
    const [job] = await db.select().from(jobs).where(eq(jobs.id, trial.jobId));
    await db
      .update(jobs)
      .set({ status: "running", error: null })
      .where(eq(jobs.id, job.id));
    // This dedicated project executes trials sequentially. Record all runs, including
    // failed attempts whose checkpoint gets replaced during recovery.
    if (!trial.priorRunIds) {
      trial.priorRunIds = (
        await db
          .select({ id: runs.id })
          .from(runs)
          .where(eq(runs.projectId, manifest.projectId))
      ).map((run) => run.id);
      await persist();
    }
    const started = performance.now();
    console.log("Running", item.id, variant, job.id);
    try {
      await jobContext.run({ id: job.id, checkpoint: job.checkpoint }, () =>
        renderMaterial(manifest.projectId),
      );
      trial.status = "done";
      await db.update(jobs).set({ status: "done" }).where(eq(jobs.id, job.id));
    } catch (error) {
      trial.status = "failed";
      trial.error = (error as Error).message;
      await db
        .update(jobs)
        .set({ status: "failed", error: trial.error })
        .where(eq(jobs.id, job.id));
    }
    trial.seconds += (performance.now() - started) / 1000;
    const [saved] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    const runIds = [
      ...new Set(
        Object.entries(saved.checkpoint)
          .filter(([key]) => key.startsWith("step:"))
          .map(([, value]) => value),
      ),
    ];
    const calls = (
      await db.select().from(runs).where(eq(runs.projectId, manifest.projectId))
    ).filter(
      (run) => runIds.includes(run.id) || !trial.priorRunIds.includes(run.id),
    );
    trial.calls = calls.map((run) => ({
      id: run.id,
      role: run.role,
      model: run.model,
      effort: run.effort,
      promptVersion: run.promptVersion,
      status: run.status,
      estimatedCost: run.estimatedCost,
      usageSource: run.usageSource,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      stepId: run.stepId,
    }));
    trial.outcome = saved.checkpoint.outcome;
    trial.reviews = JSON.parse(saved.checkpoint.reviews || "[]");
    trial.coverage = item.features.map((feature) => ({
      feature,
      state:
        trial.reviews
          .at(-1)
          ?.coverage?.find((entry: any) => entry.feature.includes(feature))
          ?.state || "uncertain",
    }));
    trial.artifacts = relative(
      output,
      resolve(DATA, "materials", job.id),
    ).replaceAll("\\", "/");
    await persist();
    console.log(
      "Finished",
      item.id,
      variant,
      trial.status,
      trial.outcome || trial.error,
    );
    if (trial.status !== "done") {
      process.chdir(repository);
      process.exitCode = 1;
      break trials;
    }
  }
process.chdir(repository);
console.log("Evaluation report:", file);
process.exit(process.exitCode || 0);
