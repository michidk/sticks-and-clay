import { eq, desc, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { readFile } from "node:fs/promises";
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
import { filePath, upload } from "./storage.server";
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
    if (path[0] === "files" && request.method === "GET") {
      const key = path.slice(1).map(decodeURIComponent).join("/");
      const file = await filePath(key);
      const types: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        webp: "image/webp",
        glb: "model/gltf-binary",
        blend: "application/octet-stream",
        json: "application/json",
        py: "text/plain",
      };
      return new Response(await readFile(file), {
        headers: {
          "Content-Type":
            types[file.split(".").pop()!] || "application/octet-stream",
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
      return reply({
        projects: list.map((p) => ({
          ...p,
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
    if (path[0] === "projects" && !path[1] && request.method === "POST") {
      const form = await request.formData();
      const name = z.string().trim().min(1).max(100).parse(form.get("name"));
      const description = z
        .string()
        .max(12000)
        .parse(form.get("description") || "");
      const files = form
        .getAll("images")
        .filter((f): f is File => f instanceof File && f.size > 0);
      if (files.length > 6) throw new Error("Maximum 6 references");
      const references = await Promise.all(files.map(upload));
      const id = crypto.randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(projects).values({ id, name, description, references });
        await tx
          .insert(jobs)
          .values({ id: crypto.randomUUID(), kind: "design", targetId: id });
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
          models: assets,
          runs: history,
          revisions: versions,
          batches: requests,
        });
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
          throw new Error("Approve the design before generating models");
        const input = z
          .object({
            prompt: z.string().trim().min(10).max(12000),
            count: z.number().int().min(1).max(20),
            judgeIterations: z.number().int().min(0).max(5),
          })
          .parse(await request.json());
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
            await tx
              .insert(jobs)
              .values({
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
    return reply(
      { error: error instanceof Error ? error.message : "Request failed" },
      400,
    );
  }
}
