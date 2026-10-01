import { expect, test } from "bun:test";
import {
  agentTimeoutMs,
  DEFAULT_AGENT_TIMEOUT_MS,
  DEFAULT_BUILDER_TIMEOUT_MS,
} from "./timeouts";

test("builder turns have a larger default timeout", () => {
  expect(agentTimeoutMs("builder", {})).toBe(DEFAULT_BUILDER_TIMEOUT_MS);
  expect(agentTimeoutMs("judge", {})).toBe(DEFAULT_AGENT_TIMEOUT_MS);
});

test("timeout overrides remain explicit and validated", () => {
  expect(agentTimeoutMs("judge", { AGENT_TIMEOUT_MS: "30000" })).toBe(30000);
  expect(
    agentTimeoutMs("builder", {
      AGENT_TIMEOUT_MS: "30000",
      BUILDER_TIMEOUT_MS: "60000",
    }),
  ).toBe(60000);
  expect(() => agentTimeoutMs("builder", { BUILDER_TIMEOUT_MS: "nope" })).toThrow(
    "Invalid AI timeout",
  );
});
