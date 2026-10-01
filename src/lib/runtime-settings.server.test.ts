import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  loadRuntimeSettings,
  saveRuntimeSettings,
  updateRuntimeSettings,
} from "./runtime-settings.server";
import { runtimeSettingsDefaults } from "./runtime-settings";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

test("runtime settings are saved atomically and loaded", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "studio-settings-"));
  temporary.push(directory);
  const path = resolve(directory, "settings.json");
  const settings = runtimeSettingsDefaults({
    AGENT_TIMEOUT_MS: "900000",
    BUILDER_TIMEOUT_MS: "2400000",
    BLENDER_BUILD_TIMEOUT_SECONDS: "480",
  });
  expect(await saveRuntimeSettings(settings, path)).toEqual(settings);
  expect(await loadRuntimeSettings(path)).toEqual(settings);
});

test("legacy timeout files are normalized without losing defaults", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "studio-settings-"));
  temporary.push(directory);
  const path = resolve(directory, "settings.json");
  await writeFile(path, JSON.stringify({
    agentTimeoutMs: 900_000,
    builderTimeoutMs: 2_400_000,
    blenderBuildTimeoutSeconds: 480,
  }));
  expect(await loadRuntimeSettings(path)).toMatchObject({
    version: 3,
    timeouts: { agentMs: 900_000, builderMs: 2_400_000, blenderSeconds: 480 },
    queue: { paused: false, concurrency: 2 },
    generationDefaults: { count: 1, judgeIterations: 2, imageSize: "1024x1024" },
  });
});

test("partial updates preserve unrelated settings and remove overrides", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "studio-settings-"));
  temporary.push(directory);
  const path = resolve(directory, "settings.json");
  await saveRuntimeSettings(runtimeSettingsDefaults(), path);
  const updated = await updateRuntimeSettings({
    queue: { paused: true, concurrency: 3 },
    agents: { builder: { model: "custom-builder", effort: "high" } },
  }, path);
  expect(updated.queue).toEqual({ paused: true, concurrency: 3 });
  expect(updated.agents.builder.model).toBe("custom-builder");
  expect((await updateRuntimeSettings({ agents: { builder: null } }, path)).agents).toEqual({});
});

test("invalid or corrupt settings cannot replace runtime policy", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "studio-settings-"));
  temporary.push(directory);
  const path = resolve(directory, "settings.json");
  await expect(
    saveRuntimeSettings(
      {
        ...runtimeSettingsDefaults(),
        timeouts: {
          ...runtimeSettingsDefaults().timeouts,
          builderMs: 60_000,
          blenderSeconds: 120,
        },
      },
      path,
    ),
  ).rejects.toThrow("Builder timeout must cover one Blender execution");
  await writeFile(path, "not json");
  await expect(loadRuntimeSettings(path)).rejects.toThrow();
});
