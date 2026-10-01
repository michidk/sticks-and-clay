import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  runtimeSettingsSchema,
  type RuntimeSettings,
} from "./contracts";
import { DATA } from "./storage.server";
import { runtimeSettingsDefaults } from "./runtime-settings";

export const RUNTIME_SETTINGS_PATH = resolve(DATA, "runtime-settings.json");

export async function loadRuntimeSettings(
  path = RUNTIME_SETTINGS_PATH,
): Promise<RuntimeSettings> {
  try {
    return runtimeSettingsSchema.parse(JSON.parse(await readFile(path, "utf8")));
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
