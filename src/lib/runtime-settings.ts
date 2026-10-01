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
    version: 2,
    timeouts: {
      agentMs,
      builderMs: numberSetting(env.BUILDER_TIMEOUT_MS, Math.max(agentMs, DEFAULT_BUILDER_TIMEOUT_MS)),
      blenderSeconds: numberSetting(env.BLENDER_BUILD_TIMEOUT_SECONDS, DEFAULT_BLENDER_BUILD_TIMEOUT_SECONDS),
      tanstackMs: 180_000,
      imageMs: 240_000,
      collectionMs: 240_000,
      analysisBlenderMs: 90_000,
      analysisPythonMs: 60_000,
    },
    queue: { paused: false, concurrency: numberSetting(env.WORKER_CONCURRENCY, 2) },
    pricing: {
      defaultText: {
        input: numberSetting(env.INPUT_USD_PER_MILLION, 2),
        cached: numberSetting(env.CACHED_USD_PER_MILLION, 0.2),
        output: numberSetting(env.OUTPUT_USD_PER_MILLION, 10),
        source: env.PRICE_SOURCE || "Operator assumption; verify configured model rates",
      },
      astra: {
        input: 10, cached: 1, output: 50,
        source: "OpenAI gpt-6-astra standard token pricing · 2026-09-29",
        longContextThreshold: 272000,
        longContextInputMultiplier: 2,
        longContextOutputMultiplier: 1.5,
      },
      image: {
        input: numberSetting(env.IMAGE_INPUT_USD_PER_MILLION, 0),
        output: numberSetting(env.IMAGE_OUTPUT_USD_PER_MILLION, 0),
        source: "Operator image-token rate assumption; zero means cost unavailable",
      },
    },
    agents: {},
    imageAgents: {},
    generationDefaults: { count: 1, judgeIterations: 2, imageSize: "1024x1024" },
  });
}

export function normalizeRuntimeSettings(input: unknown, defaults = runtimeSettingsDefaults()): RuntimeSettings {
  if (!input || typeof input !== "object") return runtimeSettingsSchema.parse(input);
  const saved = input as Record<string, unknown>;
  if (saved.version === 2) return runtimeSettingsSchema.parse(saved);
  return runtimeSettingsSchema.parse({
    ...defaults,
    timeouts: {
      ...defaults.timeouts,
      agentMs: saved.agentTimeoutMs ?? defaults.timeouts.agentMs,
      builderMs: saved.builderTimeoutMs ?? defaults.timeouts.builderMs,
      blenderSeconds: saved.blenderBuildTimeoutSeconds ?? defaults.timeouts.blenderSeconds,
    },
  });
}
