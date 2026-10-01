import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  loadRuntimeSettings,
  saveRuntimeSettings,
} from "./runtime-settings.server";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

test("runtime timeout settings are saved atomically and loaded", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "studio-settings-"));
  temporary.push(directory);
  const path = resolve(directory, "settings.json");
  const settings = {
    agentTimeoutMs: 900_000,
    builderTimeoutMs: 2_400_000,
    blenderBuildTimeoutSeconds: 480,
  };
  expect(await saveRuntimeSettings(settings, path)).toEqual(settings);
  expect(await loadRuntimeSettings(path)).toEqual(settings);
});

test("invalid or corrupt settings cannot replace runtime policy", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "studio-settings-"));
  temporary.push(directory);
  const path = resolve(directory, "settings.json");
  await expect(
    saveRuntimeSettings(
      {
        agentTimeoutMs: 60_000,
        builderTimeoutMs: 60_000,
        blenderBuildTimeoutSeconds: 120,
      },
      path,
    ),
  ).rejects.toThrow("Builder timeout must cover one Blender execution");
  await writeFile(path, "not json");
  await expect(loadRuntimeSettings(path)).rejects.toThrow();
});
