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
});
