type Event = { type: string };
/** Reattach to live work; only submit a continuation after a terminal failure. */
export function recoveryAction(events: readonly Event[], failedResult = false) {
  const start = events.map((e) => e.type).lastIndexOf("turn.started");
  const boundary = [...events]
    .reverse()
    .find((e) =>
      [
        "turn.completed",
        "turn.failed",
        "turn.cancelled",
        "session.failed",
        "input.requested",
      ].includes(e.type),
    );
  const index = boundary ? events.indexOf(boundary) : -1;
  if (
    !events.some((e) =>
      ["turn.started", "message.received"].includes(e.type),
    ) &&
    !boundary
  )
    return "start";
  if (index < start || !boundary) return "attach";
  if (boundary.type === "input.requested") return "blocked";
  if (
    ["turn.failed", "turn.cancelled", "session.failed"].includes(
      boundary.type,
    ) ||
    failedResult
  )
    return "continue";
  return "replay";
}
