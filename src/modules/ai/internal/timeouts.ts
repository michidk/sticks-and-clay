import type { Role } from "../roles";
import type { RuntimeSettings } from "../../../lib/contracts";

export function agentGenerationFailure(error: unknown, signal: AbortSignal, role: Role, timeoutMs: number, restoring = false) {
  if (!signal.aborted) return error;
  const failure = new Error(
    `Eve ${role} timed out after ${timeoutMs / 1000} seconds${restoring ? " while reading the saved session" : " while waiting for the turn to finish"}. Completed pipeline checkpoints are retained.`,
    { cause: error },
  );
  failure.name = "TimeoutError";
  return failure;
}

export function textGenerationFailure(error: unknown, signal: AbortSignal, role: Role, timeoutMs: number) {
  return signal.aborted
    ? new Error(`AI generation timed out after ${timeoutMs / 1000} seconds (${role}). Increase the text-generation timeout before resuming.`, { cause: error })
    : error;
}

/** Builder turns execute multiple bounded Blender subprocesses and need a larger envelope. */
export function agentTimeoutMs(role: Role, settings: RuntimeSettings) {
  if (role === "photographer")
    return settings.timeouts.agentMs + 7 * settings.timeouts.blenderSeconds * 1000;
  return role === "builder"
    ? settings.timeouts.builderMs
    : settings.timeouts.agentMs;
}
