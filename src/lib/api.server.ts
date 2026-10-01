import { recordedAnalysis } from "../modules/model-analysis/report";
import { databaseErrorResponse } from "./database-error";
import { eq, desc, and, inArray } from "drizzle-orm";
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
import { cancelJob } from "./queue.server";
import { runRole, roleInput, agentSettings } from "../modules/ai/index.server";
// Preserve the field-fill HTTP response shape while sharing the execution boundary.
async function draftBrief(
  args: import("../modules/ai/index.server").RunInput<
    "project-brief" | "model-brief" | "graphic-brief"
  >,
) {
  const { result, runId } = await runRole(args);
  return { ...result, runId };
}
import { readStoredFile } from "./storage.server";
import { fileMimeType } from "./storage/path";
import { prepareReferences } from "./reference-images.server";
import { downloadImage } from "./remote-image.server";
import {
  loadRuntimeSettings,
  saveRuntimeSettings,
} from "./runtime-settings.server";
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
const assetType = z.enum(["model", "graphic"]);
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
    if (path[0] === "queue") {
      if (request.method === "GET") {
        const [list, assets, collections, workspaces] = await Promise.all([
          db
            .select()
            .from(jobs)
            .where(
              inArray(jobs.kind, ["model", "plan", "demo", "project-photo"]),
            )
            .orderBy(desc(jobs.createdAt)),
          db.select().from(models),
          db.select().from(batches),
          db.select().from(projects),
        ]);
        return reply({
          jobs: list.map((j) => {
            const model = assets.find((m) => m.id === j.targetId),
              batch = collections.find(
                (b) => b.id === (model?.batchId || j.targetId),
              );
            const project = workspaces.find(
              (p) =>
                p.id ===
                (j.kind === "project-photo" ? j.targetId : batch?.projectId),
            );
            return {
              id: j.id,
              kind: j.kind,
              status: j.status,
              createdAt: j.createdAt,
              startedAt: j.startedAt,
              finishedAt: j.finishedAt,
              error: j.error,
              name:
                model?.name ||
                (j.kind === "project-photo"
                  ? "Photograph project"
                  : j.kind === "plan"
                    ? "Plan collection"
                    : "Render collection"),
              projectId: project?.id,
              projectName: project?.name,
              phase:
                model?.phase ||
                (j.kind === "project-photo"
                  ? "Photographing project collection"
                  : undefined),
              progress:
                model?.progress ??
                (j.kind === "project-photo"
                  ? j.status === "done"
                    ? 100
                    : j.checkpoint["agent:photographer:0"]
                      ? 60
                      : 5
                  : undefined),
            };
          }),
        });
      }
      if (request.method === "POST" && path[1] === "cancel-pending") {
        const pending = await db
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.status, "queued"),
              inArray(jobs.kind, ["model", "plan", "demo", "project-photo"]),
            ),
          );
        for (const j of pending) {
          const [stillQueued] = await db
            .select()
            .from(jobs)
            .where(and(eq(jobs.id, j.id), eq(jobs.status, "queued")));
          if (stillQueued) await cancelJob(j.id, true);
        }
        return reply({ ok: true });
      }
      if (request.method === "POST" && path[2] === "resume") {
        const [saved] = await db
          .select()
          .from(jobs)
          .where(eq(jobs.id, uuid.parse(path[1])));
        if (
          !saved ||
          saved.kind !== "project-photo" ||
          saved.status !== "failed"
        )
          throw new Error(
            "Only failed project photography can be resumed here",
          );
        await db
          .update(jobs)
          .set({ status: "queued", error: null, finishedAt: null })
          .where(and(eq(jobs.id, saved.id), eq(jobs.status, "failed")));
        return reply({ ok: true });
      }
      if (request.method === "POST" && path[2] === "cancel")
        return reply({ status: await cancelJob(uuid.parse(path[1])) });
    }
    if (path[0] === "agents" && request.method === "GET")
      return reply({ agents: await agentSettings() });
    if (path[0] === "settings") {
      if (request.method === "GET")
        return reply({ settings: await loadRuntimeSettings() });
      if (request.method === "PUT")
        return reply({ settings: await saveRuntimeSettings(await request.json()) });
    }
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
      return reply({
        projects: list.map((p) => ({
          ...p,
          thumbnail:
            p.assetType === "graphic"
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
              }),
              { tokens: 0, cost: 0 },
            ),
        })),
      });
    }
    if (
      path[0] === "projects" &&
      path[1] === "brief" &&
      request.method === "POST"
    ) {
      const form = await request.formData();
      const name = z.string().trim().min(1).max(100).parse(form.get("name"));
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
        const briefRole =
          type === "graphic" ? "graphic-brief" : "project-brief";
        const result = await draftBrief({
          projectId: draftId,
          role: briefRole,
          input: await roleInput(briefRole, { name, description }),
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
        const [assets, history, versions, requests] = await Promise.all([
          db
            .select()
            .from(models)
            .where(eq(models.projectId, id))
            .orderBy(models.createdAt, models.name, models.id),
          db
            .select()
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
        ]);
        return reply({
          project,
          photographs: await projectPhotographs(id),
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
          runs: history,
          revisions: versions,
          batches: requests,
        });
      }
      if (path[2] === "model-brief" && request.method === "POST") {
        if (project.status !== "ready")
          throw new Error("Approve the design first");
        const input = z
          .object({
            count: z.number().int().min(1).max(20),
            hint: z.string().max(12000).default(""),
          })
          .parse(await request.json());
        const existing = await db
          .select({ name: models.name, prompt: models.prompt })
          .from(models)
          .where(eq(models.projectId, id));
        const briefRole =
          project.assetType === "graphic" ? "graphic-brief" : "model-brief";
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
      if (path[2] === "design" && request.method === "PUT") {
        const input = z
          .object({
            design: z.string().min(100).max(50000),
            version: z.number().int().nonnegative(),
            approve: z.boolean().default(false),
          })
          .parse(await request.json());
        await db.transaction(async (tx) => {
          const updated = await tx
            .update(projects)
            .set({
              design: input.design,
              designVersion: input.version + 1,
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
        return reply({ ok: true });
      }
      if (path[2] === "generate" && request.method === "POST") {
        if (project.status !== "ready")
          throw new Error("Approve the design before generating assets");
        const input = z
          .object({
            prompt: z.string().trim().max(12000).default(""),
            count: z.number().int().min(1).max(20),
            judgeIterations: z.number().int().min(0).max(5),
            imageSize: z
              .enum(["1024x1024", "1024x1536", "1536x1024"])
              .default("1024x1024"),
          })
          .parse(await request.json());
        if (project.assetType === "graphic" && input.judgeIterations !== 0)
          throw new Error("Graphic generation does not use 3D judge rounds");
        if (project.assetType === "model" && input.imageSize !== "1024x1024")
          throw new Error("Image size applies only to graphic projects");
        const batchId = crypto.randomUUID();
        await db.transaction(async (tx) => {
          await tx.insert(batches).values({
            id: batchId,
            projectId: id,
            ...input,
            design: project.design,
            designVersion: project.designVersion,
          });
          await tx.insert(jobs).values({
            id: crypto.randomUUID(),
            kind: "plan",
            targetId: batchId,
          });
        });
        return reply({ id: batchId }, 201);
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
