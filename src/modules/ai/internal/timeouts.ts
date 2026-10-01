import type { Role } from "../roles";

export const DEFAULT_AGENT_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_BUILDER_TIMEOUT_MS = 45 * 60 * 1000;
type TimeoutEnv = {
  [key: string]: string | undefined;
  AGENT_TIMEOUT_MS?: string;
  BUILDER_TIMEOUT_MS?: string;
};

function configuredTimeout(value: string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0)
    throw new Error(`Invalid AI timeout: ${value}`);
  return timeout;
}

/** Builder turns execute multiple bounded Blender subprocesses and need a larger envelope. */
export function agentTimeoutMs(
  role: Role,
  env: TimeoutEnv = process.env,
) {
  const shared = configuredTimeout(
    env.AGENT_TIMEOUT_MS,
    DEFAULT_AGENT_TIMEOUT_MS,
  );
  if (role !== "builder") return shared;
  return configuredTimeout(
    env.BUILDER_TIMEOUT_MS,
    Math.max(shared, DEFAULT_BUILDER_TIMEOUT_MS),
  );
}
