import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/client";
import { jobs, mockups, projects } from "../db/schema";
import { runImageRole } from "../modules/ai/index.server";
import { checkpoint, jobContext } from "./checkpoint.server";
import { MAX_ACCEPTED_MOCKUPS, mockupInput, mockupImage, mockupSnapshot } from "./design-mockups";
import { validateImageFile } from "./image-file";
import { prompt } from "./prompts.server";
import { assertJobActive } from "./queue.server";
import { upload } from "./storage.server";
import { mockupReferences, workshopContext, workshopSchema } from "./workshop";
import type { z } from "zod";

const revisionRequest = (hint: string) =>
  `Revise the first supplied image, an earlier mockup, and keep what already works. ${hint || "Offer a different take on it."}`;

export async function queueDesignMockups(projectId: string, input: z.infer<typeof mockupInput>) {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects)
      .where(eq(projects.id, projectId)).for("update");
    if (!project || project.status !== "ready")
      throw new Error("Approve the design before generating mockups");
    if (project.designVersion !== input.version)
      throw new Error("Design changed. Reload before generating mockups.");
    const [active] = await tx.select().from(jobs).where(and(
      eq(jobs.kind, "design-mockups"),
      eq(jobs.targetId, projectId),
      inArray(jobs.status, ["queued", "running", "cancelling"]),
    ));
    if (active) return active.id;
    const [base] = input.baseId
      ? await tx.select().from(mockups).where(and(eq(mockups.id, input.baseId), eq(mockups.projectId, projectId)))
      : [];
    if (input.baseId && !base) throw new Error("The mockup to revise no longer exists");
    // Mockups see what a real batch would: the accepted mockups and their notes, after the project's own references.
    const direction = {
      ...workshopSchema.parse(project.workshop || {}),
      mockups: (await acceptedMockups(projectId)).filter((mockup) => mockup.key !== base?.key),
    };
    const prompts = await Promise.all(Array.from({ length: input.count }, (_, index) =>
      prompt("design-mockup", {
        name: project.name,
        description: project.description,
        design: project.design,
        assetType: project.assetType !== "model" ? "2D graphics" : "3D assets",
        request: base
          ? revisionRequest(input.hint)
          : input.hint || "Choose a useful example from the design reference.",
        variation: index + 1,
        count: input.count,
      }).then((text) => text + workshopContext(direction, false)),
    ));
    const id = crypto.randomUUID();
    await tx.insert(jobs).values({
      id,
      kind: "design-mockups",
      targetId: projectId,
      checkpoint: {
        input: JSON.stringify({
          version: input.version,
          references: [...(base ? [base.key] : []), ...project.references, ...mockupReferences(direction)],
          prompts,
          hint: input.hint,
          baseId: base?.id,
        }),
      },
    });
    return id;
  });
}

/** Generation jobs with their progress; the saved images themselves live in `listMockups`. */
export async function designMockups(projectId: string) {
  const list = await db.select().from(jobs).where(and(
    eq(jobs.kind, "design-mockups"), eq(jobs.targetId, projectId),
  )).orderBy(desc(jobs.createdAt));
  return list.map((job) => {
    const input = mockupSnapshot.parse(JSON.parse(job.checkpoint.input));
    return {
      id: job.id,
      status: job.status,
      error: job.error,
      createdAt: job.createdAt,
      version: input.version,
      count: input.prompts.length,
      hint: input.hint ?? "",
      baseId: input.baseId ?? null,
      images: input.prompts.flatMap((_, index) => {
        const saved = job.checkpoint[`mockup:${index}`];
        return saved ? [mockupImage.parse(JSON.parse(saved))] : [];
      }),
    };
  });
}

export async function listMockups(projectId: string) {
  return db.select().from(mockups).where(eq(mockups.projectId, projectId)).orderBy(desc(mockups.createdAt));
}

export async function generateDesignMockups(projectId: string) {
  const job = jobContext.getStore();
  if (!job) throw new Error("Missing durable job context");
  const input = mockupSnapshot.parse(JSON.parse(job.checkpoint.input));
  for (const [index, text] of input.prompts.entries()) {
    await assertJobActive();
    const key = `mockup:${index}`;
    // Only freshly generated images are saved as rows, so resuming never revives a deleted mockup.
    if (!job.checkpoint[key]) {
      const image = await runImageRole({
        role: "design-mockup",
        name: `mockup-${index + 1}`,
        stepId: key,
        prompt: text,
        projectId,
        directory: `mockups/${projectId}/${job.id}`,
        size: "1536x1024",
        images: input.references,
        assertActive: assertJobActive,
      });
      await assertJobActive();
      await checkpoint(key, JSON.stringify({ key: image.key, runId: image.runId }));
      await db.insert(mockups).values({
        id: `${job.id}:${index}`,
        projectId,
        key: image.key,
        source: "generated",
        designVersion: input.version,
        parentId: input.baseId ?? null,
        jobId: job.id,
        runId: image.runId,
      }).onConflictDoNothing();
    }
  }
  await checkpoint("applied", "yes");
}

export async function uploadMockup(projectId: string, file: File) {
  await validateImageFile(file);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");
  const key = await upload(file);
  const id = crypto.randomUUID();
  await db.insert(mockups).values({
    id, projectId, key, source: "uploaded", designVersion: project.designVersion,
  });
  return id;
}

export async function acceptMockup(projectId: string, id: string, note: string) {
  const [row] = await db.update(mockups)
    .set({ acceptedAt: new Date(), note })
    .where(and(eq(mockups.id, id), eq(mockups.projectId, projectId)))
    .returning();
  if (!row) throw new Error("Mockup not found");
}

export async function unacceptMockup(projectId: string, id: string) {
  const [row] = await db.update(mockups)
    .set({ acceptedAt: null })
    .where(and(eq(mockups.id, id), eq(mockups.projectId, projectId)))
    .returning();
  if (!row) throw new Error("Mockup not found");
}

export async function deleteMockup(projectId: string, id: string) {
  const [row] = await db.delete(mockups)
    .where(and(eq(mockups.id, id), eq(mockups.projectId, projectId)))
    .returning();
  if (!row) throw new Error("Mockup not found");
}

/** The visual direction a new batch freezes: accepted mockups with the user's context, newest first. */
export async function acceptedMockups(projectId: string) {
  const rows = await db.select({ key: mockups.key, note: mockups.note }).from(mockups)
    .where(and(eq(mockups.projectId, projectId), isNotNull(mockups.acceptedAt)))
    .orderBy(desc(mockups.acceptedAt))
    .limit(MAX_ACCEPTED_MOCKUPS);
  return rows;
}
