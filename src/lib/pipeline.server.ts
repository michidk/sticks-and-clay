import { executeAssetVersionJob } from "./model-pipeline.server";
import { renderAssignment } from "../modules/materials/assignment.server";
import { settleBatch } from "./batch-state.server";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { projects, revisions, batches, assetVersions, assetEntries, jobs, runs } from "../db/schema";
import { assertJobActive, plannerReservations } from "./queue.server";
import { runRole, roleInput } from "../modules/ai/index.server";
import { assetRoles } from "../modules/ai/roles";
import type { AssetType } from "./asset-types";
import { photographProject } from "./project-photography.server";
import { renderCollection } from "./collection.server";
import { mockupReferences, svgIntentOf, workshopContext } from "./workshop";
import { renderPresentation } from "./workshop-actions.server";
import { renderMaterial } from "./materials.server";
import { checkpoint, jobContext } from "./checkpoint.server";
import { generateDesignMockups } from "./design-mockups.server";
import { placeholderTitle } from "./generation.server";
async function one<T>(rows: T[]) {
  if (!rows[0]) throw new Error("Record not found");
  return rows[0];
}
export async function executeJob(kind: string, targetId: string) {
  await assertJobActive();
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  if (job.checkpoint.applied === "yes") return;
  if (kind === "design-mockups") {
    await generateDesignMockups(targetId);
    return;
  }
  if (kind === "material-assignment") {
    await renderAssignment();
    return;
  }
  if (kind === "material") {
    await renderMaterial(targetId);
    return;
  }
  if (kind === "presentation") {
    await renderPresentation();
    return;
  }
  if (kind === "project-photo") {
    await photographProject(targetId);
    await checkpoint("applied", "yes");
    return;
  }
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
    const designRole = assetRoles[p.assetType].designer;
    const input = await roleInput(designRole, {
      name: p.name,
      description: p.description,
    });
    const { result } = await runRole({
      role: designRole,
      projectId: p.id,
      input,
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
  } else if (kind === "design-from-model" || kind === "design-update") {
    const snapshot = job.checkpoint;
    const [p] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, targetId));
    const [model] = kind === "design-from-model"
      ? await db.select().from(assetVersions).where(eq(assetVersions.id, snapshot.modelId))
      : [];
    if (!p || (kind === "design-from-model" && (!model || model.projectId !== p.id)))
      throw new Error("Model or project is missing");
    if (p.designVersion !== Number(snapshot.designVersion))
      throw new Error("Design changed since this update was requested");
    const references: string[] = JSON.parse(snapshot.references);
    const updateRole = kind === "design-from-model" ? "design-from-model"
      : assetRoles[snapshot.assetType as AssetType].update;
    const { result } = await runRole({
      role: updateRole,
      projectId: p.id,
      modelId: model?.id,
      input: await roleInput(updateRole, {
        name: snapshot.name || p.name,
        description: snapshot.description || "",
        version: snapshot.designVersion,
        design: snapshot.design,
        prompt: snapshot.prompt || "",
        model: model?.name || "",
        request: snapshot.modelPrompt || "",
        summary: snapshot.sourceSummary || "",
        metrics: snapshot.sourceMetrics || "",
        feedback: snapshot.sourceFeedback || "",
      }),
      images: kind === "design-from-model" ? [...references, snapshot.view] : references,
    });
    await assertJobActive();
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(projects)
        .set({
          design: result.design,
          designVersion: p.designVersion + 1,
          references: kind === "design-from-model" ? [...references, snapshot.view] : references,
          status: "review",
          phase: "Review design",
          progress: 100,
          error: null,
        })
        .where(
          and(
            eq(projects.id, p.id),
            eq(projects.designVersion, p.designVersion),
          ),
        )
        .returning();
      if (!updated.length) throw new Error("Design changed during the update");
      await tx.insert(revisions).values({
        id: crypto.randomUUID(),
        projectId: p.id,
        version: p.designVersion + 1,
        content: result.design,
        author: kind === "design-from-model" ? "model" : "designer",
      });
      await tx
        .update(jobs)
        .set({ checkpoint: { ...snapshot, applied: "yes", resultVersion: String(p.designVersion + 1) } })
        .where(eq(jobs.id, job.id));
    });
    Object.assign(snapshot, { applied: "yes", resultVersion: String(p.designVersion + 1) });
  } else if (kind === "plan") {
    const batch = await one(
      await db.select().from(batches).where(eq(batches.id, targetId)),
    );
    await db
      .update(batches)
      .set({ status: "planning" })
      .where(eq(batches.id, batch.id));
    const [referenceProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, batch.projectId));
    if (!job.checkpoint["planner-references"])
      await checkpoint(
        "planner-references",
        JSON.stringify(batch.workshop?.references ?? [...referenceProject.references, ...mockupReferences(batch.workshop)]),
      );
    const plannerRole = assetRoles[referenceProject.assetType].planner;
    const { result, runId } = await runRole({
      images: JSON.parse(job.checkpoint["planner-references"]),
      projectId: batch.projectId,
      batchId: batch.id,
      role: plannerRole,
      input:
        (await roleInput(plannerRole, {
          version: batch.designVersion,
          design: batch.design,
          request: batch.prompt,
          count: batch.count,
        })) + workshopContext(batch.workshop, false),
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
      const iconContract = "iconContract" in result && typeof result.iconContract === "string" ? result.iconContract.trim() : undefined;
      if (iconContract && svgIntentOf(batch.workshop) === "icon")
        await tx.update(batches).set({ workshop: {
          ...(batch.workshop ?? {}), iconContract,
          version: batch.workshop?.version ?? 0,
          variation: batch.workshop?.variation ?? 25,
          effort: batch.workshop?.effort ?? "standard",
        } }).where(eq(batches.id, batch.id));
      await tx
        .update(jobs)
        .set({ checkpoint: { ...job.checkpoint, applied: "yes" } })
        .where(eq(jobs.id, job.id));
      const reserved = await tx.select().from(assetVersions).where(eq(assetVersions.batchId, batch.id)).orderBy(assetVersions.createdAt, assetVersions.id);
      const slots = await tx.select().from(assetEntries).where(eq(assetEntries.batchId, batch.id)).orderBy(assetEntries.createdAt, assetEntries.id);
      for (const [index, planned] of result.models.entries()) {
        const contract = iconContract;
        const model = { ...planned, prompt: typeof contract === "string" && contract.trim()
          ? `${planned.prompt}\n\nSHARED ICON CONSTRUCTION\n${contract}\nThe approved design and explicit user requirements take precedence.`
          : planned.prompt };
        const existing = reserved[index];
        const id = existing?.id || crypto.randomUUID();
        // A request for several assets only had a stand-in title (its first line) until now; the planner names
        // each one. A title the owner or AI wrote for an idea differs from the stand-in and is kept.
        const slot = slots[index];
        const named = !!slot && slot.title === placeholderTitle(slot.input.prompt || batch.design);
        if (named) await tx.update(assetEntries).set({ title: model.name, input: { ...slot.input, prompt: model.prompt } }).where(eq(assetEntries.id, slot.id));
        if (existing) await tx.update(assetVersions).set({ prompt: model.prompt, ...(named ? { name: model.name } : {}), status: "queued", phase: "Queued", progress: 0, error: null }).where(eq(assetVersions.id, id));
        else await tx.insert(assetVersions).values({
          id, projectId: batch.projectId, batchId: batch.id,
          ...(slots[index] ? { assetId: slots[index].id } : {}), ...model,
        });
        await tx.insert(jobs).values({ id: crypto.randomUUID(), kind: "model", targetId: id });
      }
      await tx
        .update(batches)
        .set({ status: "building" })
        .where(eq(batches.id, batch.id));
    });
  } else if (kind === "model") {
    await executeAssetVersionJob(targetId);
  }
}
export async function failJob(kind: string, id: string, error: string) {
  if (kind === "design-from-model" || kind === "design-update") return;
  if (kind === "design")
    await db
      .update(projects)
      .set({ status: "failed", phase: "Setup failed", error })
      .where(eq(projects.id, id));
  if (kind === "plan") await db.update(assetVersions)
    .set({ status: "failed", phase: "Planning failed", error })
    .where(plannerReservations(id));
  if (kind === "plan" || kind === "demo")
    await db
      .update(batches)
      .set({ status: "failed", error })
      .where(eq(batches.id, id));
  if (kind === "model") {
    const [m] = await db
      .update(assetVersions)
      .set({ status: "failed", phase: "Generation failed", error })
      .where(eq(assetVersions.id, id))
      .returning();
    if (m) await settleBatch(m.batchId);
  }
}
