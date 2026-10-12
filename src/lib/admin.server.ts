import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { jobs, models, batches, projects } from "../db/schema";
import { agentInput } from "./api-inputs";
import { cancelJob } from "./queue.server";
import { agentSettings } from "../modules/ai/index.server";
import {
  loadRuntimeSettings,
  saveRuntimeSettings,
  updateRuntimeSettings,
} from "./runtime-settings.server";
import { readWorkerHeartbeat } from "./worker-control.server";
import { diagnosticsSnapshot } from "./diagnostics.server";

const uuid = z.string().uuid();
const reply = (value: unknown) => Response.json(value);

export async function adminAction(request: Request, path: string[]) {
  if (path[0] === "queue") {
    if (request.method === "GET") {
      const [list, assets, collections, workspaces, settings, worker] =
        await Promise.all([
          db
            .select()
            .from(jobs)
            .where(
              inArray(jobs.kind, [
                "model",
                "plan",
                "demo",
                "project-photo",
                "design-mockups",
                "presentation",
                "material-assignment",
                "material",
              ]),
            )
            .orderBy(desc(jobs.createdAt)),
          db.select().from(models),
          db.select().from(batches),
          db.select().from(projects),
          loadRuntimeSettings(),
          readWorkerHeartbeat(),
        ]);
      return reply({
        control: {
          ...settings.queue,
          activeJobs: worker?.activeJobs ?? 0,
          workerHealthy: worker?.healthy ?? false,
        },
        jobs: list.map((j) => {
          const model = assets.find((m) => m.id === j.targetId),
            batch = collections.find(
              (b) => b.id === (model?.batchId || j.targetId),
            );
          const project = workspaces.find(
            (p) =>
              p.id ===
              (["project-photo", "material", "design-mockups"].includes(j.kind)
                ? j.targetId
                : batch?.projectId),
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
              (j.kind === "design-mockups"
                ? "Design mockups"
                : j.kind === "material"
                ? "PBR material"
                : j.kind === "presentation"
                  ? `Render ${model?.name || "saved version"}`
                  : model?.name) ||
              (j.kind === "project-photo"
                ? "Photograph project"
                : j.kind === "plan"
                  ? "Plan collection"
                  : "Render collection"),
            projectId: project?.id,
            modelId: model?.id,
            projectName: project?.name,
            phase:
              (j.kind === "material"
                ? "Generating material maps"
                : j.kind === "presentation"
                  ? "Rendering saved version"
                  : model?.phase) ||
              (j.kind === "project-photo"
                ? "Photographing project collection"
                : undefined),
            progress:
              (["presentation", "material", "material-assignment"].includes(
                j.kind,
              )
                ? j.status === "done"
                  ? 100
                  : 5
                : model?.progress) ??
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
            inArray(jobs.kind, [
              "model",
              "plan",
              "demo",
              "project-photo",
              "design-mockups",
              "presentation",
              "material-assignment",
              "material",
            ]),
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
        ![
          "project-photo",
          "design-mockups",
          "presentation",
          "material",
          "material-assignment",
        ].includes(saved.kind) ||
        saved.status !== "failed"
      )
        throw new Error(
          "Only failed mockup, photography, presentation or material jobs can be resumed here",
        );
      if (saved.kind === "design-mockups") {
        await db.transaction(async (tx) => {
          await tx.select().from(projects)
            .where(eq(projects.id, saved.targetId)).for("update");
          const [active] = await tx.select().from(jobs).where(and(
            eq(jobs.kind, "design-mockups"), eq(jobs.targetId, saved.targetId),
            inArray(jobs.status, ["queued", "running", "cancelling"]),
          ));
          if (active) throw new Error("Mockups are already in progress for this project");
          await tx.update(jobs).set({ status: "queued", error: null, finishedAt: null })
            .where(and(eq(jobs.id, saved.id), eq(jobs.status, "failed")));
        });
        return reply({ ok: true });
      }
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
  if (path[0] === "agents" && request.method === "PATCH") {
    const input = agentInput.parse(await request.json());
    const configured = (await agentSettings()).find(
      (agent) => agent.id === input.id,
    );
    if (!configured || configured.engine !== input.engine)
      throw new Error("Unknown or mismatched agent role");
    const patch =
      input.engine === "imagegen"
        ? {
            imageAgents: {
              [input.id]: { model: input.model, quality: input.effort },
            },
          }
        : {
            agents: {
              [input.id]: { model: input.model, effort: input.effort },
            },
          };
    await updateRuntimeSettings(patch);
    return reply({ agents: await agentSettings() });
  }
  if (path[0] === "settings") {
    if (request.method === "GET")
      return reply({ settings: await loadRuntimeSettings() });
    if (request.method === "PUT")
      return reply({
        settings: await saveRuntimeSettings(await request.json()),
      });
    if (request.method === "PATCH")
      return reply({
        settings: await updateRuntimeSettings(await request.json()),
      });
  }
  if (path[0] === "diagnostics" && request.method === "GET")
    return reply(await diagnosticsSnapshot());
  return null;
}
