import { expect, test } from "bun:test";
import { recoveryAction } from "./recovery";
const events = (...types: string[]) => types.map((type) => ({ type }));
test("recovery does not resubmit running or completed work", () => {
  expect(recoveryAction(events("session.started"))).toBe("start");
  expect(recoveryAction(events("message.received"))).toBe("attach");
  expect(recoveryAction(events("turn.started", "step.completed"))).toBe(
    "attach",
  );
  expect(recoveryAction(events("turn.started", "turn.completed"))).toBe(
    "replay",
  );
  expect(
    recoveryAction(events("turn.started", "turn.failed", "turn.started")),
  ).toBe("attach");
});
test("failed turns continue, operator input stays blocked, invalid results can be repaired", () => {
  expect(recoveryAction(events("turn.started", "turn.failed"))).toBe(
    "continue",
  );
  expect(recoveryAction(events("turn.started", "turn.cancelled"))).toBe(
    "continue",
  );
  expect(recoveryAction(events("turn.started", "input.requested"))).toBe(
    "blocked",
  );
  expect(recoveryAction(events("turn.started", "turn.completed"), true)).toBe(
    "continue",
  );
  expect(recoveryAction([
    { type: "turn.started" },
    { type: "turn.failed", data: { message: "structured output finalization produced no result" } },
  ])).toBe("continue");
});
test("dead workflows and lost sandbox state need a new run, ordinary failures retain the session", () => {
  expect(recoveryAction(events("session.failed"))).toBe("restart");
  expect(recoveryAction(events("turn.started", "step.completed", "session.failed"))).toBe("restart");
  expect(recoveryAction([{ type: "turn.failed", data: { message: "Docker sandbox session container eve-session-123 no longer exists." } }])).toBe("restart");
  expect(recoveryAction([{ type: "turn.failed", data: { message: "Sandbox template is not provisioned" } }])).toBe("continue");
  expect(recoveryAction([
    { type: "turn.started" },
    { type: "turn.failed", data: { message: "Docker sandbox session container eve-session-123 no longer exists." } },
    { type: "turn.started" },
  ])).toBe("attach");
});

test("a changed sandbox provider starts a fresh run while retaining prior history", () => {
  const failed = { type: "turn.failed", data: { error: { message: 'Sandbox session state belongs to provider "docker", not "just-bash".' } } };
  expect(recoveryAction([{ type: "turn.started" }, failed])).toBe("restart");
  expect(recoveryAction([failed, { type: "turn.started" }])).toBe("attach");
});
