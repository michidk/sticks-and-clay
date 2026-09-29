import { and, eq } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../db/client";
import { projects, revisions, batches, models, jobs, runs } from "../db/schema";
import { assertJobActive } from "./queue.server";
import { archiveVersion } from "./versions.server";
import { prompt } from "./prompts.server";
import { draftBrief } from "./direct-api.server";
import { agent } from "./agent.server";
import { renderCollection } from "./collection.server";
import {
  designResult,
  planResult,
  buildResult,
  judgeResult,
  nextStage,
} from "./contracts";
import { DATA } from "./storage.server";
import { checkpoint, jobContext } from "./checkpoint.server";
async function one<T>(rows: T[]) {
  if (!rows[0]) throw new Error("Record not found");
  return rows[0];
}
export async function executeJob(kind: string, targetId: string) {
  await assertJobActive();
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  if (job.checkpoint.applied === "yes") return;
  if (kind === "demo") {
    await renderCollection(targetId);
    await checkpoint("applied", "yes");
    return;
  }
  if (kind === "design") {
    const p = await one(
      await db.select().from(projects).where(eq(projects.id, targetId)),
    );
    await db
      .update(projects)
      .set({
        status: "designing",
        phase: "Reading references and writing design",
        progress: 20,
      })
      .where(eq(projects.id, p.id));
    const input = await prompt("designer-input", {
      name: p.name,
      description: p.description,
    });
    const result = job.checkpoint["agent:designer:0"]
      ? (
          await agent<{ design: string }>({
            role: "designer",
            projectId: p.id,
            input,
            images: p.references,
            schema: designResult,
          })
        ).result
      : await draftBrief({
          role: "designer",
          projectId: p.id,
          input: await prompt("designer-input", {
            name: p.name,
            description: p.description,
          }),
          images: p.references,
        });
    await assertJobActive();
    await db.transaction(async (tx) => {
      await tx
        .update(projects)
        .set({
          design: result.design,
          designVersion: p.designVersion + 1,
          status: "review",
          phase: "Review and approve design",
          progress: 100,
        })
        .where(eq(projects.id, p.id));
      await tx
        .update(jobs)
        .set({ checkpoint: { ...job.checkpoint, applied: "yes" } })
        .where(eq(jobs.id, job.id));
      await tx.insert(revisions).values({
        id: crypto.randomUUID(),
        projectId: p.id,
        version: p.designVersion + 1,
        content: result.design,
        author: "designer",
      });
    });
  } else if (kind === "plan") {
    const batch = await one(
      await db.select().from(batches).where(eq(batches.id, targetId)),
    );
    await db
      .update(batches)
      .set({ status: "planning" })
      .where(eq(batches.id, batch.id));
    const { result, runId } = await agent<{
      models: { name: string; prompt: string }[];
    }>({
      projectId: batch.projectId,
      batchId: batch.id,
      role: "planner",
      input: await prompt("planner-input", {
        version: batch.designVersion,
        design: batch.design,
        request: batch.prompt,
        count: batch.count,
      }),
      schema: planResult,
    });
    if (result.models.length !== batch.count) {
      const error = `Result validation: Planner returned ${result.models.length} models; expected ${batch.count}`;
      await db
        .update(runs)
        .set({ status: "failed", error })
        .where(eq(runs.id, runId));
      throw new Error(error);
    }
    await assertJobActive();
    await db.transaction(async (tx) => {
      await tx
        .update(jobs)
        .set({ checkpoint: { ...job.checkpoint, applied: "yes" } })
        .where(eq(jobs.id, job.id));
      for (const model of result.models) {
        const id = crypto.randomUUID();
        await tx.insert(models).values({
          id,
          projectId: batch.projectId,
          batchId: batch.id,
          ...model,
        });
        await tx
          .insert(jobs)
          .values({ id: crypto.randomUUID(), kind: "model", targetId: id });
      }
      await tx
        .update(batches)
        .set({ status: "building" })
        .where(eq(batches.id, batch.id));
    });
  } else if (kind === "model") {
    const model = await one(
      await db.select().from(models).where(eq(models.id, targetId)),
    );
    const batch = await one(
      await db.select().from(batches).where(eq(batches.id, model.batchId)),
    );
    const project = await one(
      await db.select().from(projects).where(eq(projects.id, model.projectId)),
    );
    let feedback: unknown = model.feedback,
      previous = model.artifacts?.blend
        ? resolve(DATA, String(model.artifacts.blend))
        : "",
      passed = false,
      artifacts: Record<string, unknown> = {};
    const attempt = job.checkpoint.workspace || job.id;
    const rounds = Math.max(1, batch.judgeIterations);
    for (let iteration = 0; iteration < rounds; iteration++) {
      const directory = `models/${model.id}/${attempt}/iteration-${iteration}`;
      await mkdir(resolve(DATA, directory), { recursive: true });
      const capabilityKey = `capability:${iteration}`;
      const capability = job.checkpoint[capabilityKey] || crypto.randomUUID();
      if (!job.checkpoint[capabilityKey])
        await checkpoint(capabilityKey, capability);
      await mkdir(resolve(DATA, "capabilities"), { recursive: true });
      await writeFile(
        resolve(DATA, "capabilities", capability + ".json"),
        JSON.stringify({ directory }),
      );
      await db
        .update(models)
        .set({
          status: "building",
          phase: iteration
            ? "Applying judge feedback"
            : "Building geometry and materials",
          iteration,
          progress: Math.round((iteration / rounds) * 100),
        })
        .where(eq(models.id, model.id));
      let buildProgress = Math.round((iteration / rounds) * 100);
      const { runId: builderRunId } = await agent({
        role: "builder",
        onActivity: async (tool) => {
          const phase = tool.includes("view_render")
            ? "Inspecting rendered asset"
            : tool.includes("execute_blender_code")
              ? "Building geometry, exporting and rendering"
              : tool.includes("get_scene_info")
                ? "Inspecting Blender workspace"
                : null;
          if (!phase) return;
          const fraction = tool.includes("view_render")
            ? 0.45
            : tool.includes("execute_blender_code")
              ? 0.15
              : 0.05;
          await db
            .update(models)
            .set({
              phase,
              progress: (buildProgress = Math.max(
                buildProgress,
                Math.round(((iteration + fraction) / rounds) * 100),
              )),
            })
            .where(eq(models.id, model.id));
        },
        projectId: model.projectId,
        batchId: batch.id,
        modelId: model.id,
        iteration,
        images: project.references,
        schema: buildResult,
        input: await prompt("builder-input", {
          version: batch.designVersion,
          design: batch.design,
          name: model.name,
          request: model.prompt,
          capability,
          directory: resolve(DATA, directory),
          previous: previous || "None",
          feedback: JSON.stringify(feedback || null, null, 2),
        }),
      });
      let metrics: any;
      let images: string[];
      try {
        metrics = JSON.parse(
          await readFile(resolve(DATA, directory, "metrics.json"), "utf8"),
        );
        const glb = await readFile(resolve(DATA, directory, "asset.glb"));
        if (
          glb.toString("ascii", 0, 4) !== "glTF" ||
          glb.readUInt32LE(4) !== 2 ||
          glb.readUInt32LE(8) !== glb.length
        )
          throw new Error("Invalid GLB export");
        const manifest = JSON.parse(
          glb.toString("utf8", 20, 20 + glb.readUInt32LE(12)),
        );
        if (!manifest.meshes?.length) throw new Error("GLB contains no meshes");
        images = ["front", "rear", "detail"].map(
          (view) => `${directory}/${view}.png`,
        );
        for (const image of images) await readFile(resolve(DATA, image));
        await readFile(resolve(DATA, directory, "source.blend"));
        artifacts = {
          glb: `${directory}/asset.glb`,
          blend: `${directory}/source.blend`,
          renders: images,
          metrics,
        };
      } catch (error) {
        const runId = job.checkpoint[`agent:builder:${iteration}`];
        if (runId)
          await db
            .update(runs)
            .set({
              status: "failed",
              error: "Artifact validation: " + String(error),
            })
            .where(eq(runs.id, runId));
        throw error;
      }
      await assertJobActive();
      artifacts = await archiveVersion(builderRunId, directory);
      images = artifacts.renders as string[];
      previous = resolve(DATA, String(artifacts.blend));
      await db
        .update(models)
        .set({
          artifacts,
          phase: batch.judgeIterations
            ? "Reviewing rendered views"
            : "Export verified",
          progress: Math.round(((iteration + 0.6) / rounds) * 100),
          status: batch.judgeIterations ? "judging" : "building",
        })
        .where(eq(models.id, model.id));
      if (batch.judgeIterations) {
        const { result } = await agent<{
          passed: boolean;
          score: number;
          summary: string;
          improvements: unknown[];
        }>({
          role: "judge",
          projectId: model.projectId,
          batchId: batch.id,
          modelId: model.id,
          iteration,
          images,
          schema: judgeResult,
          input: await prompt("judge-input", {
            design: batch.design,
            request: model.prompt,
            metrics: JSON.stringify(metrics),
            feedback: JSON.stringify(feedback),
          }),
        });
        await assertJobActive();
        feedback = result;
        passed = result.passed;
        await db
          .update(models)
          .set({
            feedback: result,
            verdict: passed ? "approved" : "changes_requested",
          })
          .where(eq(models.id, model.id));
        if (nextStage(passed, iteration + 1, rounds) !== "revise") break;
      }
    }
    await assertJobActive();
    const verdict = !batch.judgeIterations
      ? "unreviewed"
      : passed
        ? "approved"
        : "limit_reached";
    await db
      .update(models)
      .set({
        status: "done",
        progress: 100,
        phase:
          verdict === "approved"
            ? "Approved"
            : verdict === "unreviewed"
              ? "Complete · no judge requested"
              : "Complete · review limit reached",
        verdict,
        artifacts,
      })
      .where(eq(models.id, model.id));
    await settleBatch(batch.id);
    await checkpoint("applied", "yes");
  }
}
export async function failJob(kind: string, id: string, error: string) {
  if (kind === "design")
    await db
      .update(projects)
      .set({ status: "failed", phase: "Setup failed", error })
      .where(eq(projects.id, id));
  if (kind === "plan" || kind === "demo")
    await db
      .update(batches)
      .set({ status: "failed", error })
      .where(eq(batches.id, id));
  if (kind === "model") {
    const [m] = await db
      .update(models)
      .set({ status: "failed", phase: "Generation failed", error })
      .where(eq(models.id, id))
      .returning();
    if (m) await settleBatch(m.batchId);
  }
}
async function settleBatch(id: string) {
  const rows = await db.select().from(models).where(eq(models.batchId, id));
  if (
    !rows.length ||
    !rows.every((m) => ["done", "failed", "cancelled"].includes(m.status))
  )
    return;
  await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(batches)
      .set({
        status: rows.some((m) => m.status === "done")
          ? "rendering"
          : "completed_with_errors",
      })
      .where(and(eq(batches.id, id), eq(batches.status, "building")))
      .returning();
    if (claimed && rows.some((m) => m.status === "done"))
      await tx
        .insert(jobs)
        .values({ id: crypto.randomUUID(), kind: "demo", targetId: id });
  });
}
