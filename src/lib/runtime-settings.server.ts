import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  runtimeSettingsPatchSchema,
  runtimeSettingsSchema,
  type RuntimeSettings,
  type RuntimeSettingsPatch,
} from "./contracts";
import { DATA } from "./storage.server";
import { normalizeRuntimeSettings, runtimeSettingsDefaults } from "./runtime-settings";

export const RUNTIME_SETTINGS_PATH = resolve(DATA, "runtime-settings.json");

export async function loadRuntimeSettings(
  path = RUNTIME_SETTINGS_PATH,
): Promise<RuntimeSettings> {
  try {
    return normalizeRuntimeSettings(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return runtimeSettingsDefaults();
    throw error;
  }
}

export async function saveRuntimeSettings(
  input: unknown,
  path = RUNTIME_SETTINGS_PATH,
) {
  const settings = runtimeSettingsSchema.parse(input);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(settings, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return settings;
}

function mergeOverrides<T extends Record<string, unknown>>(
  current: T,
  patch: Record<string, unknown | null> | undefined,
) {
  if (!patch) return current;
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged as T;
}

export async function updateRuntimeSettings(input: unknown, path = RUNTIME_SETTINGS_PATH) {
  const patch: RuntimeSettingsPatch = runtimeSettingsPatchSchema.parse(input);
  const current = await loadRuntimeSettings(path);
  return saveRuntimeSettings({
    ...current,
    timeouts: { ...current.timeouts, ...patch.timeouts },
    queue: { ...current.queue, ...patch.queue },
    agents: mergeOverrides(current.agents, patch.agents),
    imageAgents: mergeOverrides(current.imageAgents, patch.imageAgents),
    generationDefaults: { ...current.generationDefaults, ...patch.generationDefaults },
  }, path);
}
