import type { Role } from "../roles";
import type { RuntimeSettings } from "../../../lib/contracts";

/** Builder turns execute multiple bounded Blender subprocesses and need a larger envelope. */
export function agentTimeoutMs(role: Role, settings: RuntimeSettings) {
  if (role === "photographer")
    return settings.timeouts.agentMs + 7 * settings.timeouts.blenderSeconds * 1000;
  return role === "builder"
    ? settings.timeouts.builderMs
    : settings.timeouts.agentMs;
}
