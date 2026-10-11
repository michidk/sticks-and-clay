import { loadRuntimeSettings } from "../../lib/runtime-settings.server";
import { imageRoles, roles, type Role } from "./roles";

export async function textRoleProfile(role: Role) {
  const settings = await loadRuntimeSettings();
  return {
    ...roles[role],
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
