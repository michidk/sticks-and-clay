import { decideVisualTarget } from "./visual-target.server";
import { visualTargetDecisionInput } from "./api-inputs";
import { adminAction } from "./admin.server";
import {
  assetBriefInput,
  branchInput,
  designInput,
  designPromptInput,
  designUpdateInput,
  generationInput,
} from "./api-inputs";
import { recordedAnalysis } from "../modules/model-analysis/report";
import { workshopSchema } from "./workshop";
import { snapshotWorkshop } from "./workshop.server";
import { workshopAction } from "./workshop-actions.server";
import { materialAction } from "./materials.server";
import { collectionSummary } from "./project-summary";
import { databaseErrorResponse } from "./database-error";
import { eq, desc, and, inArray, or, getTableColumns, sql } from "drizzle-orm";
import { assertDesignIdle } from "./design-updates.server";
import { immediateRunView, queueJobView } from "./queue-view";
import { z } from "zod";
import { db } from "../db/client";
import {
  projects,
  revisions,
  batches,
  models,
  runs,
  events,
  jobs,
} from "../db/schema";
import { projectPhotographs } from "./project-photography.server";
import { runRole, roleInput, immediateRoles } from "../modules/ai/index.server";
// Preserve the field-fill HTTP response shape while sharing the execution boundary.
async function draftBrief<
  R extends "project-name" | "project-brief" | "model-brief" | "graphic-brief",
>(args: import("../modules/ai/index.server").RunInput<R>) {
  const { result, runId } = await runRole(args);
  return { ...result, runId };
}
import { readStoredFile } from "./storage.server";
import { fileMimeType } from "./storage/path";
import { prepareReferences } from "./reference-images.server";
import { readWorkerHeartbeat } from "./worker-control.server";
import { downloadImage } from "./remote-image.server";
import { mockupInput } from "./design-mockups";
import { designMockups, queueDesignMockups } from "./design-mockups.server";
import { queueGeneration } from "./generation.server";
import { discardModelIdea, listModelIdeas, saveModelIdea, startModelIdea, updateModelIdea } from "./model-ideas.server";
async function resumeJob(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  kinds: string[],
  targetId: string,
) {
  const [latest] = await tx
    .select()
    .from(jobs)
    .where(and(inArray(jobs.kind, kinds), eq(jobs.targetId, targetId)))
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  if (!latest || latest.status !== "failed") return null;
  const [resumed] = await tx
    .update(jobs)
    .set({ status: "queued", error: null, finishedAt: null })
    .where(and(eq(jobs.id, latest.id), eq(jobs.status, "failed")))
    .returning();
  return resumed || null;
}
const uuid = z.string().uuid();
const assetType = z.enum(["model", "graphic", "svg"]);
const reply = (v: unknown, status = 200) => Response.json(v, { status });
export async function api(request: Request) {
  try {
    const path = new URL(request.url).pathname
      .replace(/^\/api\/?/, "")
      .split("/");
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (
        origin &&
        ![
          new URL(request.url).host,
          request.headers.get("host"),
          request.headers.get("x-forwarded-host"),
          process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).host : null,
        ].includes(new URL(origin).host)
      )
        return reply({ error: "Invalid request origin" }, 403);
    }
    const materialResult = await materialAction(request, path);
    if (materialResult) return materialResult;
    const workshopResult = await workshopAction(request, path);
    if (workshopResult) return workshopResult;
    const adminResult = await adminAction(request, path);
    if (adminResult) return adminResult;
    if (
      path[0] === "textures" &&
      path[1] === "generate" &&
      request.method === "POST"
    ) {
      const { generateTexture, textureRequest } =
        await import("../modules/textures/index.server");
      return reply(
        await generateTexture(textureRequest.parse(await request.json())),
      );
    }
    if (
      path[0] === "images" &&
      path[1] === "import" &&
      request.method === "POST"
    ) {
      const { url } = z
        .object({ url: z.string().url().max(2048) })
        .parse(await request.json());
      return reply(await downloadImage(url));
    }
    if (path[0] === "files" && request.method === "GET") {
      const key = path.slice(1).map(decodeURIComponent).join("/");
      return new Response(await readStoredFile(key), {
        headers: {
          "Content-Type": fileMimeType(key),
          "X-Content-Type-Options": "nosniff",
          ...(fileMimeType(key) === "image/svg+xml" ? { "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'" } : {}),
          "Cache-Control": "private, max-age=60",
        },
      });
    }
    if (path[0] === "projects" && !path[1] && request.method === "GET") {
      const list = await db
        .select()
        .from(projects)
        .orderBy(desc(projects.createdAt));
      const usage = await db
        .select({
          projectId: runs.projectId,
          input: runs.inputTokens,
          output: runs.outputTokens,
          cost: runs.estimatedCost,
        })
        .from(runs);
      const photos = await projectPhotographs();
      const generated = await db
        .select()
        .from(models)
        .orderBy(desc(models.createdAt));
      const collections = await db
        .select({
          id: batches.id,
          projectId: batches.projectId,
          status: batches.status,
          count: batches.count,
        })
        .from(batches);
      const designWork = await db.select({ projectId: jobs.targetId }).from(jobs).where(and(
        inArray(jobs.kind, ["design", "design-from-model", "design-update"]),
        inArray(jobs.status, ["queued", "running", "cancelling"]),
      ));
      const worker = await readWorkerHeartbeat();
      return reply({
        workerHealthy: worker?.healthy ?? false,
        projects: list.map((p) => ({
          ...p,
          designUpdating: designWork.some((job) => job.projectId === p.id),
          collection: collectionSummary(
            generated.filter((m) => m.projectId === p.id),
            collections.filter((b) => b.projectId === p.id),
          ),
          thumbnail:
            p.assetType !== "model"
              ? generated.find(
                  (asset) =>
                    asset.projectId === p.id &&
                    typeof asset.artifacts?.image === "string",
                )?.artifacts?.image
              : photos.find((photo) => photo.projectId === p.id)?.thumbnail,
          usage: usage
            .filter((r) => r.projectId === p.id)
            .reduce(
              (a, r) => ({
                tokens: a.tokens + r.input + r.output,
                cost: a.cost + (r.cost || 0),
                unpriced: a.unpriced + (r.cost === null ? 1 : 0),
              }),
              { tokens: 0, cost: 0, unpriced: 0 },
            ),
        })),
      });
    }
    if (
      path[0] === "projects" &&
      path[1] === "name" &&
      request.method === "POST"
    ) {
      const form = await request.formData();
      const description = z
        .string()
        .trim()
        .max(12000)
        .parse(form.get("description") || "");
      const type = assetType.parse(form.get("assetType") || "model");
      const draftId = form.get("draftId")
        ? uuid.parse(form.get("draftId"))
        : crypto.randomUUID();
      const saved = form.get("draftId")
        ? (
            await db
              .select()
              .from(projects)
              .where(
                and(
                  eq(projects.id, uuid.parse(form.get("draftId"))),
                  eq(projects.status, "draft"),
                ),
              )
          )[0]
        : undefined;
      if (form.get("draftId") && !saved)
        throw new Error("Project setup has already started");
      const { references, rollback } = await prepareReferences(
        form,
        saved?.references,
      );
      if (!description && !references.length)
        throw new Error(
          "Add a brief or reference images before generating a project name",
        );
      try {
        if (saved) {
          const updated = await db
            .update(projects)
            .set({ assetType: type, description, references, phase: "Naming project" })
            .where(and(eq(projects.id, draftId), eq(projects.status, "draft")))
            .returning();
          if (!updated.length)
            throw new Error("Project setup has already started");
        } else {
          await db.insert(projects).values({
            id: draftId,
            name: "Untitled project",
            assetType: type,
            description,
            references,
            status: "draft",
            phase: "Naming project",
          });
        }
      } catch (error) {
        await rollback();
        throw error;
      }
      try {
        const result = await draftBrief({
          projectId: draftId,
          role: "project-name",
          input: await roleInput("project-name", { description }),
          images: references,
        });
        await db
          .update(projects)
          .set({ name: result.name, phase: "Review project setup" })
          .where(and(eq(projects.id, draftId), eq(projects.status, "draft")));
        return reply({ id: draftId, references, ...result }, 201);
      } catch (error) {
        const databaseFailure = databaseErrorResponse(error);
        if (databaseFailure)
          return reply(
            { ...databaseFailure.body, draftId, references },
            databaseFailure.status,
          );
        return reply(
          {
            error:
              error instanceof Error
                ? error.message
                : "Project name generation failed",
            draftId,
            references,
          },
          400,
        );
      }
    }
    if (
      path[0] === "projects" &&
      path[1] === "brief" &&
      request.method === "POST"
    ) {
      const form = await request.formData();
      // Notes or references alone can seed a brief; the user names it afterwards.
      const name =
        z.string().trim().max(100).parse(form.get("name") || "") ||
        "Untitled project";
      const description = z
        .string()
        .max(12000)
        .parse(form.get("description") || "");
      const type = assetType.parse(form.get("assetType") || "model");
      const draftId = form.get("draftId")
        ? uuid.parse(form.get("draftId"))
        : crypto.randomUUID();
      const saved = form.get("draftId")
        ? (
            await db
              .select()
              .from(projects)
              .where(
                and(
                  eq(projects.id, uuid.parse(form.get("draftId"))),
                  eq(projects.status, "draft"),
                ),
              )
          )[0]
        : undefined;
      if (form.get("draftId") && !saved)
        throw new Error("Project setup has already started");
      const { references, rollback } = await prepareReferences(
        form,
        saved?.references,
      );
      await db
        .transaction(async (tx) => {
          if (form.get("draftId")) {
            const updated = await tx
              .update(projects)
              .set({
                name,
                assetType: type,
                description,
                references,
              })
              .where(
                and(eq(projects.id, draftId), eq(projects.status, "draft")),
              )
              .returning();
            if (!updated.length)
              throw new Error("Project setup has already started");
          } else
            await tx.insert(projects).values({
              id: draftId,
              name,
              assetType: type,
              description,
              references,
              status: "draft",
              phase: "Drafting project brief",
            });
        })
        .catch(async (error) => {
          await rollback();
          throw error;
        });
      const [draft] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, draftId));
      try {
        const result = await draftBrief({
          projectId: draftId,
          role: "project-brief",
          input: await roleInput("project-brief", { name, description }),
          images: draft.references,
        });
        await db
          .update(projects)
          .set({ description: result.brief, phase: "Review project brief" })
          .where(and(eq(projects.id, draftId), eq(projects.status, "draft")));
        return reply(
          { id: draftId, references: draft.references, ...result },
          201,
        );
      } catch (error) {
        const databaseFailure = databaseErrorResponse(error);
        if (databaseFailure)
          return reply(
            { ...databaseFailure.body, draftId, references: draft.references },
            databaseFailure.status,
          );
        return reply(
          {
            error:
              error instanceof Error
                ? error.message
                : "Brief generation failed",
            draftId,
            references: draft.references,
          },
          400,
        );
      }
    }
    if (path[0] === "projects" && !path[1] && request.method === "POST") {
      const form = await request.formData();
      const name = z.string().trim().min(1).max(100).parse(form.get("name"));
      const description = z
        .string()
        .trim()
        .max(12000)
        .parse(form.get("description") || "");
      const type = assetType.parse(form.get("assetType") || "model");
      const saved = form.get("draftId")
        ? (
            await db
              .select()
              .from(projects)
              .where(
                and(
                  eq(projects.id, uuid.parse(form.get("draftId"))),
                  eq(projects.status, "draft"),
                ),
              )
          )[0]
        : undefined;
      if (form.get("draftId") && !saved)
        throw new Error("Project setup has already started");
      const { references, rollback } = await prepareReferences(
        form,
        saved?.references,
      );
      const id = form.get("draftId")
        ? uuid.parse(form.get("draftId"))
        : crypto.randomUUID();
      await db
        .transaction(async (tx) => {
          if (form.get("draftId")) {
            const updated = await tx
              .update(projects)
              .set({
                name,
                assetType: type,
                description,
                references,
                status: "queued",
                phase: "Waiting for designer",
                progress: 0,
              })
              .where(and(eq(projects.id, id), eq(projects.status, "draft")))
              .returning();
            if (!updated.length)
              throw new Error("Project setup has already started");
          } else
            await tx
              .insert(projects)
              .values({ id, name, assetType: type, description, references });
          await tx
            .insert(jobs)
            .values({ id: crypto.randomUUID(), kind: "design", targetId: id });
        })
        .catch(async (error) => {
          await rollback();
          throw error;
        });
      return reply({ id }, 201);
    }
    if (path[0] === "projects" && path[1]) {
      const id = uuid.parse(path[1]);
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, id));
      if (!project) return reply({ error: "Project not found" }, 404);
      if (request.method === "POST" && path[2] === "photograph") {
        const existing = await db
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.kind, "project-photo"),
              eq(jobs.targetId, id),
              inArray(jobs.status, ["queued", "running"]),
            ),
          );
        if (existing.length) return reply({ id: existing[0].id });
        const resumed = await db.transaction((tx) =>
          resumeJob(tx, ["project-photo"], id),
        );
        if (resumed) return reply({ id: resumed.id });
        const jobId = crypto.randomUUID();
        await db
          .insert(jobs)
          .values({ id: jobId, kind: "project-photo", targetId: id });
        return reply({ id: jobId }, 201);
      }
      if (request.method === "GET") {
        const summary = new URL(request.url).searchParams.get("summary") === "true";
        const [assets, history, versions, requests, designUpdates, activeJobs] =
          await Promise.all([
            db
              .select()
              .from(models)
              .where(eq(models.projectId, id))
              .orderBy(models.createdAt, models.name, models.id),
            db
              .select({
                ...getTableColumns(runs),
                ...(summary ? {
                  systemPrompt: sql<string>`''`,
                  input: sql<string>`case when ${runs.role} = 'judge' then ${runs.input} else '' end`,
                  output: sql<string | null>`null`,
                  images: sql<string[]>`'[]'::jsonb`,
                } : {}),
              })
              .from(runs)
              .where(eq(runs.projectId, id))
              .orderBy(desc(runs.createdAt)),
            db
              .select()
              .from(revisions)
              .where(eq(revisions.projectId, id))
              .orderBy(desc(revisions.version)),
            db
              .select()
              .from(batches)
              .where(eq(batches.projectId, id))
              .orderBy(desc(batches.createdAt)),
            db
              .select()
              .from(jobs)
              .where(
                and(inArray(jobs.kind, ["design-from-model", "design-update"]), eq(jobs.targetId, id)),
              )
              .orderBy(desc(jobs.createdAt)),
            db.select().from(jobs).where(and(
              inArray(jobs.status, ["queued", "running", "cancelling"]),
              or(
                eq(jobs.targetId, id),
                inArray(jobs.targetId, db.select({ id: models.id }).from(models).where(eq(models.projectId, id))),
                inArray(jobs.targetId, db.select({ id: batches.id }).from(batches).where(eq(batches.projectId, id))),
              ),
            )).orderBy(jobs.createdAt),
          ]);
        return reply({
          project,
          photographs: await projectPhotographs(id),
          mockups: await designMockups(id),
          ideas: await listModelIdeas(id),
          models: assets,
          versions: history
            .filter((r) => r.role === "builder" && r.modelId)
            .map((r) => {
              const next = history
                .filter(
                  (n) =>
                    n.role === "builder" &&
                    n.modelId === r.modelId &&
                    n.createdAt > r.createdAt,
                )
                .sort(
                  (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
                )[0];
              const judges = history.filter(
                (j) =>
                  j.role === "judge" &&
                  j.modelId === r.modelId &&
                  j.iteration === r.iteration &&
                  j.createdAt >= r.createdAt &&
                  (!next || j.createdAt < next.createdAt),
              );
              return {
                id: r.id,
                modelId: r.modelId,
                iteration: r.iteration,
                status: r.status,
                createdAt: r.createdAt,
                artifacts: (r.result as any)?.artifacts,
                summary: (r.result as any)?.summary,
                error: r.error,
                judges: judges.map((j) => ({
                  id: j.id,
                  status: j.status,
                  result: j.result,
                  analysis: recordedAnalysis(j.input),
                  error: j.error,
                  createdAt: j.createdAt,
                })),
              };
            }),
          runs: summary ? history.map(({ systemPrompt, input, output, images, ...run }) => run) : history,
          revisions: versions,
          batches: requests,
          workerHealthy: (await readWorkerHeartbeat())?.healthy ?? false,
          activeJobs: [
            ...activeJobs.map((job) => queueJobView(job, assets, requests, [project])),
            ...history.filter((run) => run.status === "running" && immediateRoles.some((role) => role === run.role))
              .map((run) => immediateRunView(run, project)),
          ],
          designUpdates: designUpdates.map(
            ({ id, status, error, checkpoint, createdAt }) => ({
              id,
              status,
              error,
              createdAt,
              modelId: checkpoint.modelId,
              prompt: checkpoint.prompt,
              designVersion: Number(checkpoint.designVersion),
              resultVersion: checkpoint.resultVersion ? Number(checkpoint.resultVersion) : null,
            }),
          ),
        });
      }
      if (path[2] === "ideas") {
        if (path.length === 3 && request.method === "POST") {
          const input = generationInput.parse(await request.json());
          return reply({ id: await saveModelIdea(project, input) }, 201);
        }
        if (path.length === 4 && request.method === "PUT") {
          await updateModelIdea(project, uuid.parse(path[3]), generationInput.parse(await request.json()));
          return reply({ ok: true });
        }
        if (path.length === 4 && request.method === "DELETE") {
          await discardModelIdea(id, uuid.parse(path[3]));
          return reply({ ok: true });
        }
        if (path.length === 5 && path[4] === "generate" && request.method === "POST")
          return reply({ id: await startModelIdea(id, uuid.parse(path[3])) }, 201);
      }
      if (path[2] === "mockups" && request.method === "POST") {
        const input = mockupInput.parse(await request.json());
        return reply({ id: await queueDesignMockups(id, input) }, 201);
      }
      if (path[2] === "model-brief" && request.method === "POST") {
        if (project.status !== "ready")
          throw new Error("Approve the design first");
        const input = assetBriefInput.parse(await request.json());
        const existing = await db
          .select({ name: models.name, prompt: models.prompt })
          .from(models)
          .where(eq(models.projectId, id));
        const briefRole =
          project.assetType !== "model" ? "graphic-brief" : "model-brief";
        const text = await roleInput(briefRole, {
          name: project.name,
          version: project.designVersion,
          design: project.design,
          count: input.count,
          assets:
            existing
              .map((model) => `- ${model.name}: ${model.prompt}`)
              .join("\n") || "None",
          hint: input.hint || "Propose a useful set.",
        });
        return reply(
          await draftBrief({ projectId: id, role: briefRole, input: text }),
        );
      }
      if (path[2] === "design-update" && request.method === "POST") {
        const input = designPromptInput.parse(await request.json());
        const jobId = crypto.randomUUID();
        await db.transaction(async (tx) => {
          const [current] = await tx.select().from(projects)
            .where(eq(projects.id, id)).for("update");
          if (!current || !current.design || !["ready", "review"].includes(current.status))
            throw new Error("The design must be available before updating it");
          if (current.designVersion !== input.version)
            throw new Error("Design changed. Load the latest revision before requesting an update.");
          await assertDesignIdle(id, tx);
          await tx.insert(jobs).values({
            id: jobId,
            kind: "design-update",
            targetId: id,
            checkpoint: {
              prompt: input.prompt,
              name: current.name,
              description: current.description,
              assetType: current.assetType,
              design: current.design,
              designVersion: String(current.designVersion),
              references: JSON.stringify(current.references),
            },
          });
        });
        return reply({ id: jobId }, 201);
      }
      if (path[2] === "design" && request.method === "PUT") {
        const form = request.headers
          .get("content-type")
          ?.includes("multipart/form-data")
          ? await request.formData()
          : null;
        const input = designInput.parse(
          form
            ? {
                design: form.get("design"),
                version: JSON.parse(String(form.get("version"))),
                approve: form.has("approve")
                  ? JSON.parse(String(form.get("approve")))
                  : false,
              }
            : await request.json(),
        );
        const prepared = form
          ? await prepareReferences(form, project.references)
          : null;
        try {
          await db.transaction(async (tx) => {
            await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).for("update");
            await assertDesignIdle(id, tx);
            const updated = await tx
              .update(projects)
              .set({
                design: input.design,
                designVersion: input.version + 1,
                ...(prepared ? { references: prepared.references } : {}),
                status: input.approve ? "ready" : "review",
                progress: 100,
                phase: input.approve ? "Ready to build" : "Review design",
                error: null,
              })
              .where(
                and(
                  eq(projects.id, id),
                  eq(projects.designVersion, input.version),
                  inArray(projects.status, ["ready", "review"]),
                ),
              )
              .returning();
            if (!updated.length)
              throw new Error(
                "Design changed or is still generating. Reload before saving.",
              );
            await tx.insert(revisions).values({
              id: crypto.randomUUID(),
              projectId: id,
              version: input.version + 1,
              content: input.design,
              author: "user",
            });
          });
        } catch (error) {
          await prepared?.rollback();
          throw error;
        }
        return reply({ ok: true });
      }
      if (path[2] === "workshop" && request.method === "PUT") {
        const input = workshopSchema.parse(await request.json());
        const previous = workshopSchema.parse(project.workshop || {});
        if (input.version !== previous.version)
          throw new Error("Collection settings changed; reload before saving");
        await snapshotWorkshop(id, input);
        const [updated] = await db
          .update(projects)
          .set({ workshop: { ...input, version: input.version + 1 } })
          .where(
            and(
              eq(projects.id, id),
              project.workshop
                ? eq(projects.workshop, project.workshop)
                : (await import("drizzle-orm")).isNull(projects.workshop),
            ),
          )
          .returning();
        if (!updated)
          throw new Error("Collection settings changed; reload before saving");
        return reply({ workshop: updated.workshop });
      }
      if (path[2] === "generate" && request.method === "POST") {
        const input = generationInput.parse(await request.json());
        return reply({ id: await queueGeneration(id, input) }, 201);
      }
      if (path[2] === "retry-design" && request.method === "POST") {
        if (project.status !== "failed")
          throw new Error("Only failed setup can be retried");
        await db.transaction(async (tx) => {
          const updated = await tx
            .update(projects)
            .set({
              status: "queued",
              phase: "Waiting for designer",
              progress: 0,
              error: null,
            })
            .where(and(eq(projects.id, id), eq(projects.status, "failed")))
            .returning();
          if (!updated.length)
            throw new Error("Setup is already being retried");
          const resumed = await resumeJob(tx, ["design"], id);
          if (!resumed)
            await tx.insert(jobs).values({
              id: crypto.randomUUID(),
              kind: "design",
              targetId: id,
            });
        });
        return reply({ ok: true });
      }
    }
    if (path[0] === "models" && path[1] && path[2] === "visual-target" && request.method === "POST") {
      await decideVisualTarget(uuid.parse(path[1]), visualTargetDecisionInput.parse(await request.json()));
      return reply({ ok: true });
    }
    if (
      path[0] === "models" &&
      path[1] &&
      path[2] === "branch" &&
      request.method === "POST"
    ) {
      const id = uuid.parse(path[1]);
      const input = branchInput.parse(await request.json());
      const [parent] = await db.select().from(models).where(eq(models.id, id));
      if (!parent) return reply({ error: "Model not found" }, 404);
      const [source] = await db
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.id, input.sourceRunId),
            eq(runs.modelId, id),
            inArray(runs.role, ["builder", "graphic", "svg"]),
          ),
        );
      if (
        !source ||
        source.status !== "done" ||
        !(
          (source.result as any)?.artifacts?.blend ||
          ((source.role === "graphic" || source.role === "svg") && (source.result as any)?.key)
        )
      )
        throw new Error("Choose a saved build version with a Blender source");
      const [parentBatch] = await db
        .select()
        .from(batches)
        .where(eq(batches.id, parent.batchId));
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, parent.projectId));
      if (!parentBatch || !project)
        throw new Error("Source project is unavailable");
      if (project.assetType !== "model" && source.role !== project.assetType)
        throw new Error("Graphic variants need a saved graphic");
      if (project.assetType === "model" && source.role !== "builder")
        throw new Error("Choose a saved model version");
      const batchId = crypto.randomUUID();
      const modelId = crypto.randomUUID();
      const name = input.kind === "fork" ? input.name : parent.name;
      if (!name) throw new Error("Name the fork");
      if (input.objectReference) {
        const saved = z.object({ artifacts: z.object({ glb: z.string() }) }).safeParse(source.result);
        if (source.role !== "builder" || !saved.success ||
            input.objectReference.glb !== saved.data.artifacts.glb) {
          throw new Error("The selected object belongs to a different model version. Select it again.");
        }
      }
      const fullPrompt = `${parent.prompt}\n\nRequested change from saved version:\n${input.prompt}`;
      const workshop = input.useCurrentStyle
        ? await snapshotWorkshop(project.id, project.workshop)
        : parentBatch.workshop;
      await db.transaction(async (tx) => {
        await tx.insert(batches).values({
          id: batchId,
          visualTargetMode: "review",
          projectId: parent.projectId,
          prompt: input.prompt,
          count: 1,
          judgeIterations: input.judgeIterations,
          design: parentBatch.design,
          designVersion: parentBatch.designVersion,
          imageSize: parentBatch.imageSize,
          workshop,
          status: "building",
        });
        await tx.insert(models).values({
          id: modelId,
          projectId: parent.projectId,
          batchId,
          name,
          prompt: fullPrompt,
          parentModelId: parent.id,
          sourceRunId: source.id,
          changePrompt: input.prompt,
          objectReference: input.objectReference,
          branchKind: input.kind,
        });
        await tx.insert(jobs).values({
          id: crypto.randomUUID(),
          kind: "model",
          targetId: modelId,
          checkpoint: {
            "branch-references": JSON.stringify([
              ...((source.role === "graphic" || source.role === "svg")
                ? [(source.result as any).key]
                : []),
              ...project.references,
            ]),
          },
        });
      });
      return reply({ id: modelId }, 201);
    }
    if (
      path[0] === "models" &&
      path[1] &&
      path[2] === "design-update" &&
      request.method === "POST"
    ) {
      const id = uuid.parse(path[1]);
      const input = designUpdateInput.parse(await request.json());
      const [model] = await db.select().from(models).where(eq(models.id, id));
      if (!model) return reply({ error: "Model not found" }, 404);
      const [source] = await db
        .select()
        .from(runs)
        .where(
          and(
            eq(runs.id, input.sourceRunId),
            eq(runs.modelId, id),
            eq(runs.role, "builder"),
          ),
        );
      const artifacts = (source?.result as any)?.artifacts;
      const view = artifacts?.renders?.[input.view];
      if (!source || source.status !== "done" || !view)
        throw new Error("Choose a saved build and render view");
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, model.projectId));
      if (!project || !["ready", "review"].includes(project.status))
        throw new Error("The design must be available before updating it");
      if (
        input.replaceReference &&
        !project.references.includes(input.replaceReference)
      )
        throw new Error("Choose a reference from this project to replace");
      if (project.references.length >= 6 && !input.replaceReference)
        throw new Error(
          "Choose a reference to replace before adding this model view",
        );
      const references = project.references.filter(
        (key) => key !== input.replaceReference,
      );
      const jobId = crypto.randomUUID();
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(projects)
          .where(eq(projects.id, project.id)).for("update");
        if (!current || current.designVersion !== project.designVersion ||
          !["ready", "review"].includes(current.status))
          throw new Error("Design changed. Reload before requesting an update.");
        await assertDesignIdle(project.id, tx);
        await tx.insert(jobs).values({
          id: jobId,
          kind: "design-from-model",
          targetId: project.id,
          checkpoint: {
            modelId: id,
            sourceRunId: source.id,
            view,
            designVersion: String(project.designVersion),
            design: project.design,
            references: JSON.stringify(references),
            modelPrompt: model.prompt,
            sourceSummary: String(
              (source.result as any)?.summary || "Not recorded",
            ),
            sourceMetrics: JSON.stringify(artifacts.metrics || {}),
            sourceFeedback: JSON.stringify(
              model.artifacts?.blend === artifacts.blend ? model.feedback : null,
            ),
          },
        });
      });
      return reply({ id: jobId }, 201);
    }
    if (
      path[0] === "models" &&
      path[1] &&
      path[2] === "retry" &&
      request.method === "POST"
    ) {
      const id = uuid.parse(path[1]);
      await db.transaction(async (tx) => {
        const [model] = await tx
          .update(models)
          .set({
            status: "queued",
            phase: "Queued for retry",
            progress: 0,
            error: null,
          })
          .where(and(eq(models.id, id), eq(models.status, "failed")))
          .returning();
        if (!model) throw new Error("Only failed models can be retried");
        await tx
          .update(batches)
          .set({ status: "building", error: null })
          .where(eq(batches.id, model.batchId));
        const resumed = await resumeJob(tx, ["model"], id);
        if (!resumed)
          await tx
            .insert(jobs)
            .values({ id: crypto.randomUUID(), kind: "model", targetId: id });
      });
      return reply({ ok: true });
    }
    if (
      path[0] === "batches" &&
      path[2] === "resume" &&
      request.method === "POST"
    ) {
      const id = uuid.parse(path[1]);
      await db.transaction(async (tx) => {
        const resumed = await resumeJob(tx, ["plan", "demo"], id);
        if (!resumed) throw new Error("No failed batch work to resume");
        await tx
          .update(batches)
          .set({
            status: resumed.kind === "demo" ? "rendering" : "queued",
            error: null,
          })
          .where(eq(batches.id, id));
      });
      return reply({ ok: true });
    }
    if (path[0] === "runs" && path[1] && path[2] === "details" && request.method === "GET") {
      const [run] = await db.select().from(runs).where(eq(runs.id, uuid.parse(path[1])));
      if (!run) return reply({ error: "Run not found" }, 404);
      const log = new URL(request.url).searchParams.get("events") === "false"
        ? []
        : await db.select().from(events).where(eq(events.runId, run.id)).orderBy(events.createdAt);
      return reply({ run, events: log });
    }
    if (path[0] === "runs" && path[1] && request.method === "GET")
      return reply(
        await db
          .select()
          .from(events)
          .where(eq(events.runId, uuid.parse(path[1])))
          .orderBy(events.createdAt),
      );
    return reply({ error: "Not found" }, 404);
  } catch (error) {
    const databaseFailure = databaseErrorResponse(error);
    if (databaseFailure)
      return reply(databaseFailure.body, databaseFailure.status);
    return reply(
      { error: error instanceof Error ? error.message : "Request failed" },
      400,
    );
  }
}
