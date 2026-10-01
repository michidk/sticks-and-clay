import {
  runtimeSettingsSchema,
  type RuntimeSettings,
} from "./contracts";

export const DEFAULT_AGENT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_BUILDER_TIMEOUT_MS = 45 * 60 * 1000;
export const DEFAULT_BLENDER_BUILD_TIMEOUT_SECONDS = 10 * 60;

type TimeoutEnv = {
  [key: string]: string | undefined;
  AGENT_TIMEOUT_MS?: string;
  BUILDER_TIMEOUT_MS?: string;
  BLENDER_BUILD_TIMEOUT_SECONDS?: string;
};

function configuredTimeout(value: string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new Error(`Invalid AI timeout: ${value}`);
  return timeout;
}

export function runtimeSettingsDefaults(
  env: TimeoutEnv = process.env,
): RuntimeSettings {
  const shared = configuredTimeout(
    env.AGENT_TIMEOUT_MS,
    DEFAULT_AGENT_TIMEOUT_MS,
  );
  return runtimeSettingsSchema.parse({
    agentTimeoutMs: shared,
    builderTimeoutMs: configuredTimeout(
      env.BUILDER_TIMEOUT_MS,
      Math.max(shared, DEFAULT_BUILDER_TIMEOUT_MS),
    ),
    blenderBuildTimeoutSeconds: configuredTimeout(
      env.BLENDER_BUILD_TIMEOUT_SECONDS,
      DEFAULT_BLENDER_BUILD_TIMEOUT_SECONDS,
    ),
  });
}
