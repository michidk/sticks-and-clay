import { loadRuntimeSettings } from "../../lib/runtime-settings.server";
import { imageRoles, roles, type Role } from "./roles";

/** Claude equivalents of the registry's default tiers; per-role overrides still win. */
const claudeModels: Record<string, string> = {
  "gpt-6-sol": "claude-sonnet-5-5",
  "gpt-6-astra": "claude-opus-5-5",
};

export async function textRoleProfile(role: Role) {
  const settings = await loadRuntimeSettings();
  const { model } = roles[role];
  const preset = {
    ...roles[role],
    model: settings.textPreset === "claude" ? claudeModels[model] ?? model : model,
  };
  return {
    ...preset,
    ...settings.agents[role],
    settings,
  };
}

export async function imageRoleProfile(role: keyof typeof imageRoles) {
  const settings = await loadRuntimeSettings();
  return {
    ...imageRoles[role],
    ...settings.imageAgents[role],
    settings,
  };
}
