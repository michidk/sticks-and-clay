import type { Role } from "../roles";
import type { RuntimeSettings } from "../../../lib/contracts";

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
