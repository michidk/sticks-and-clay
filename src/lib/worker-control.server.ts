import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { RuntimeSettings } from "./contracts";
import { loadRuntimeSettings } from "./runtime-settings.server";
import { DATA } from "./storage.server";

export const WORKER_HEARTBEAT_PATH = resolve(DATA, "worker-heartbeat.json");
export type WorkerHeartbeat = {
  updatedAt: string;
  activeJobs: number;
  configuredConcurrency: number;
  effectiveConcurrency: number;
  paused: boolean;
};

export function laneCanClaim(laneIndex: number, queue: RuntimeSettings["queue"]) {
  return !queue.paused && laneIndex < queue.concurrency;
}

export async function writeWorkerHeartbeat(
  activeJobs: number,
  path = WORKER_HEARTBEAT_PATH,
) {
  const { queue } = await loadRuntimeSettings();
  const heartbeat: WorkerHeartbeat = {
    updatedAt: new Date().toISOString(),
    activeJobs,
    configuredConcurrency: queue.concurrency,
    effectiveConcurrency: queue.paused ? 0 : queue.concurrency,
    paused: queue.paused,
  };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(heartbeat) + "\n", { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return heartbeat;
}

export async function readWorkerHeartbeat(path = WORKER_HEARTBEAT_PATH) {
  try {
    const heartbeat = JSON.parse(await readFile(path, "utf8")) as WorkerHeartbeat;
    const ageMs = Date.now() - Date.parse(heartbeat.updatedAt);
    return { ...heartbeat, healthy: Number.isFinite(ageMs) && ageMs < 10_000 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
