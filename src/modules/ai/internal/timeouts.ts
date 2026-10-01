import type { Role } from "../roles";
import type { RuntimeSettings } from "../../../lib/contracts";

/** Builder turns execute multiple bounded Blender subprocesses and need a larger envelope. */
export function agentTimeoutMs(role: Role, settings: RuntimeSettings) {
  return role === "builder"
    ? settings.timeouts.builderMs
    : settings.timeouts.agentMs;
}
