import { expect, test } from "bun:test";
import { agentStateFromStatus } from "./agent-state";

test("normalizes workflow statuses into the agent lifecycle", () => {
  expect(agentStateFromStatus("queued")).toBe("queued");
  expect(agentStateFromStatus("designing")).toBe("working");
  expect(agentStateFromStatus("running")).toBe("working");
  expect(agentStateFromStatus("done")).toBe("completed");
  expect(agentStateFromStatus("failed")).toBe("completed");
  expect(agentStateFromStatus("cancelled")).toBe("completed");
});
