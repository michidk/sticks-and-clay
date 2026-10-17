import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { jobs, models, batches, projects, runs, oauthClients, mcpAuditEvents } from "../db/schema";
import { getMcpConfig } from "../modules/mcp/auth/config.server";
import { DrizzleOAuthStore } from "../modules/mcp/auth/oauth-store.server";
import { agentInput, type AgentInput } from "./api-inputs";
import { cancelJob } from "./queue.server";
import { agentSettings, immediateRoles } from "../modules/ai/index.server";
import {
  loadRuntimeSettings,
  saveRuntimeSettings,
  updateRuntimeSettings,
} from "./runtime-settings.server";
import { readWorkerHeartbeat } from "./worker-control.server";
import { diagnosticsSnapshot } from "./diagnostics.server";
import { immediateRunView, queueJobView } from "./queue-view";

const uuid = z.string().uuid();
const reply = (value: unknown) => Response.json(value);

export async function adminAction(request: Request, path: string[]) {
  if (path[0] === "queue") {
    if (request.method === "GET") {
      const [list, assets, collections, workspaces, drafts, settings, worker] =
        await Promise.all([
          db
            .select()
            .from(jobs)
            .orderBy(desc(jobs.createdAt)),
          db.select().from(models),
          db.select().from(batches),
          db.select().from(projects),
          db.select().from(runs).where(inArray(runs.role, immediateRoles))
            .orderBy(desc(runs.createdAt)),
          loadRuntimeSettings(),
          readWorkerHeartbeat(),
        ]);
      return reply({
        control: {
          ...settings.queue,
          activeJobs: list.filter((job) => ["running", "cancelling"].includes(job.status)).length +
            drafts.filter((run) => run.status === "running").length,
          workerHealthy: worker?.healthy ?? false,
        },
        jobs: [
          ...list.map((job) => queueJobView(job, assets, collections, workspaces)),
          ...drafts.map((run) => immediateRunView(run, workspaces.find((p) => p.id === run.projectId))),
        ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      });
    }
    if (request.method === "POST" && path[1] === "cancel-pending") {
      const pending = await db
        .select()
        .from(jobs)
        .where(eq(jobs.status, "queued"));
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
    const body = await request.json();
    // One role, or `{ agents: [...] }` to change several in a single write.
    const inputs = z
      .array(agentInput)
      .min(1)
      .max(100)
      .parse(Array.isArray(body?.agents) ? body.agents : [body]);
    const configured = await agentSettings();
    const patch: {
      agents: Record<string, { model: string; effort: AgentInput["effort"] }>;
      imageAgents: Record<string, { model: string; quality: AgentInput["effort"] }>;
    } = { agents: {}, imageAgents: {} };
    for (const input of inputs) {
      const role = configured.find((agent) => agent.id === input.id);
      if (!role || role.engine !== input.engine)
        throw new Error("Unknown or mismatched agent role");
      if (input.engine === "imagegen")
        patch.imageAgents[input.id] = { model: input.model, quality: input.effort };
      else patch.agents[input.id] = { model: input.model, effort: input.effort };
    }
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
  if (path[0] === "mcp") {
    if (request.method === "GET") {
      let endpoint: string | null = null;
      let configurationError: string | null = null;
      try { endpoint = getMcpConfig(request).serverUrl.href; }
      catch (error) { configurationError = (error as Error).message; }
      const [clients, audit] = await Promise.all([
        db.select().from(oauthClients).orderBy(desc(oauthClients.createdAt)),
        db.select().from(mcpAuditEvents).orderBy(desc(mcpAuditEvents.createdAt)).limit(25),
      ]);
      return reply({ endpoint, configurationError, clients, audit });
    }
    if (request.method === "POST" && path[1] === "revoke") {
      await new DrizzleOAuthStore().revokeClient(uuid.parse((await request.json()).clientId));
      return reply({ ok: true });
    }
  }
  if (path[0] === "diagnostics" && request.method === "GET")
    return reply(await diagnosticsSnapshot());
  return null;
}
