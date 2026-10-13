import { runtimeSettingsSchema, type RuntimeSettings } from "./contracts";

export const DEFAULT_AGENT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_BUILDER_TIMEOUT_MS = 45 * 60 * 1000;
export const DEFAULT_BLENDER_BUILD_TIMEOUT_SECONDS = 10 * 60;
type RuntimeEnv = Record<string, string | undefined>;

function numberSetting(value: string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid runtime setting: ${value}`);
  return parsed;
}

export function runtimeSettingsDefaults(env: RuntimeEnv = process.env): RuntimeSettings {
  const agentMs = numberSetting(env.AGENT_TIMEOUT_MS, DEFAULT_AGENT_TIMEOUT_MS);
  return runtimeSettingsSchema.parse({
    version: 3,
    timeouts: {
      agentMs,
      builderMs: numberSetting(env.BUILDER_TIMEOUT_MS, Math.max(agentMs, DEFAULT_BUILDER_TIMEOUT_MS)),
      blenderSeconds: numberSetting(env.BLENDER_BUILD_TIMEOUT_SECONDS, DEFAULT_BLENDER_BUILD_TIMEOUT_SECONDS),
      tanstackMs: 180_000,
      imageMs: 240_000,
      collectionMs: 900_000, // two Cycles renders; 240s expired on a 2-CPU pod
      analysisBlenderMs: 90_000,
      analysisPythonMs: 60_000,
    },
    queue: { paused: false, concurrency: numberSetting(env.WORKER_CONCURRENCY, 2) },
    agents: {},
    imageAgents: {},
    generationDefaults: { count: 1, judgeIterations: 2, imageSize: "1024x1024" },
  });
}

export function normalizeRuntimeSettings(input: unknown, defaults = runtimeSettingsDefaults()): RuntimeSettings {
  if (!input || typeof input !== "object") return runtimeSettingsSchema.parse(input);
  const saved = input as Record<string, unknown>;
  if (saved.version === 3) return runtimeSettingsSchema.parse(saved);
  const savedTimeouts = saved.timeouts && typeof saved.timeouts === "object"
    ? saved.timeouts as Record<string, unknown>
    : {};
  return runtimeSettingsSchema.parse({
    ...defaults,
    ...saved,
    version: 3,
    timeouts: {
      ...defaults.timeouts,
      ...savedTimeouts,
      agentMs: savedTimeouts.agentMs ?? saved.agentTimeoutMs ?? defaults.timeouts.agentMs,
      builderMs: savedTimeouts.builderMs ?? saved.builderTimeoutMs ?? defaults.timeouts.builderMs,
      blenderSeconds: savedTimeouts.blenderSeconds ?? saved.blenderBuildTimeoutSeconds ?? defaults.timeouts.blenderSeconds,
    },
  });
}
