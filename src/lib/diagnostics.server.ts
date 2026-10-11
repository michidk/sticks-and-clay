import { statfs } from "node:fs/promises";
import { desc, eq } from "drizzle-orm";
import { db, sql } from "../db/client";
import { jobs } from "../db/schema";
import { loadRuntimeSettings } from "./runtime-settings.server";
import { DATA, getStorage } from "./storage.server";
import { readWorkerHeartbeat } from "./worker-control.server";

async function probe(url: string, requireOk = false) {
  const started = performance.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return {
      status: requireOk && !response.ok ? "degraded" as const : "healthy" as const,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch {
    return { status: "unavailable" as const, latencyMs: null };
  }
}

async function databaseHealth() {
  const started = performance.now();
  try {
    await sql`select 1`;
    return { status: "healthy" as const, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { status: "unavailable" as const, latencyMs: null };
  }
}

async function storageHealth() {
  const provider = process.env.STORAGE_PROVIDER === "s3" ? "s3" : "local";
  try {
    const objects = await getStorage().listObjects();
    const usedBytes = objects.reduce((total, object) => total + object.sizeBytes, 0);
    const disk = provider === "local" ? await statfs(DATA) : null;
    return {
      status: "healthy" as const,
      provider,
      objectCount: objects.length,
      usedBytes,
      availableBytes: disk ? disk.bavail * disk.bsize : null,
    };
  } catch {
    return {
      status: "unavailable" as const,
      provider,
      objectCount: null,
      usedBytes: null,
      availableBytes: null,
    };
  }
}

export async function diagnosticsSnapshot() {
  const [settings, database, worker, eve, blender, storage, failures] = await Promise.all([
    loadRuntimeSettings(),
    databaseHealth(),
    readWorkerHeartbeat(),
    probe(`${(process.env.EVE_URL || "http://127.0.0.1:33441").replace(/\/$/, "")}/eve/v1/health`, true),
    probe(process.env.BLENDER_MCP_URL || "http://127.0.0.1:33442/mcp"),
    storageHealth(),
    db.select({ kind: jobs.kind, finishedAt: jobs.finishedAt })
      .from(jobs).where(eq(jobs.status, "failed")).orderBy(desc(jobs.finishedAt)).limit(5),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    services: {
      database,
      worker: worker
        ? {
            status: worker.healthy ? "healthy" : "unavailable",
            activeJobs: worker.activeJobs,
            paused: worker.paused,
            configuredConcurrency: worker.configuredConcurrency,
            effectiveConcurrency: worker.effectiveConcurrency,
            lastSeenAt: worker.updatedAt,
          }
        : {
            status: "unavailable",
            activeJobs: 0,
            paused: settings.queue.paused,
            configuredConcurrency: settings.queue.concurrency,
            effectiveConcurrency: 0,
            lastSeenAt: null,
          },
      eve,
      blender,
      storage,
    },
    recentFailures: failures.map((failure) => ({
      kind: failure.kind,
      finishedAt: failure.finishedAt,
    })),
    effectiveSettings: settings,
    restartRequired: [],
  };
}
