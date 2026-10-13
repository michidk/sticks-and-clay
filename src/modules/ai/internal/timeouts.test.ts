import { expect, test } from "bun:test";
import {
  DEFAULT_AGENT_TIMEOUT_MS,
  DEFAULT_BLENDER_BUILD_TIMEOUT_SECONDS,
  DEFAULT_BUILDER_TIMEOUT_MS,
  runtimeSettingsDefaults,
} from "../../../lib/runtime-settings";
import { agentTimeoutMs } from "./timeouts";

test("builder turns have a larger default timeout", () => {
  const settings = runtimeSettingsDefaults({});
  expect(agentTimeoutMs("builder", settings)).toBe(DEFAULT_BUILDER_TIMEOUT_MS);
  expect(agentTimeoutMs("judge", settings)).toBe(DEFAULT_AGENT_TIMEOUT_MS);
  expect(agentTimeoutMs("photographer", settings)).toBe(5_400_000);
  expect(settings.timeouts.blenderSeconds).toBe(
    DEFAULT_BLENDER_BUILD_TIMEOUT_SECONDS,
  );
});

test("timeout overrides remain explicit and validated", () => {
  const settings = runtimeSettingsDefaults({
    AGENT_TIMEOUT_MS: "60000",
    BUILDER_TIMEOUT_MS: "120000",
    BLENDER_BUILD_TIMEOUT_SECONDS: "90",
  });
  expect(agentTimeoutMs("judge", settings)).toBe(60000);
  expect(agentTimeoutMs("builder", settings)).toBe(120000);
  expect(agentTimeoutMs("photographer", settings)).toBe(690000);
  expect(settings.timeouts.blenderSeconds).toBe(90);
  expect(() =>
    runtimeSettingsDefaults({ BUILDER_TIMEOUT_MS: "nope" }),
  ).toThrow("Invalid runtime setting");
});
