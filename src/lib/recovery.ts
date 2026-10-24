type Event = { type: string; data?: unknown };
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
  const failure = boundary?.type === "turn.failed" ? JSON.stringify(boundary.data) ?? "" : "";
  const finalizationFailure = failure.includes("structured output finalization produced no result");
  if (
    index >= start &&
    (boundary?.type === "session.failed" ||
      (boundary?.type === "turn.failed" &&
        ((failure.includes("Docker sandbox session container") && failure.includes("no longer exists")) ||
          failure.includes("Sandbox session state belongs to provider"))))
  )
    return "restart";
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
    ["turn.failed", "turn.cancelled"].includes(
      boundary.type,
    ) ||
    failedResult ||
    finalizationFailure
  )
    return "continue";
  return "replay";
}
