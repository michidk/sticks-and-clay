import { Badge } from "@/components/ui/badge";

export type AgentState = "queued" | "working" | "completed";

const completedStatuses = new Set([
  "done",
  "completed",
  "ready",
  "review",
  "failed",
  "cancelled",
]);

export function agentStateFromStatus(status: string): AgentState {
  if (status === "queued") return "queued";
  if (completedStatuses.has(status)) return "completed";
  return "working";
}

export function AgentStateBadge({ state }: { state: AgentState }) {
  return (
    <Badge
      variant="secondary"
      className={`agent-state-badge agent-state-${state}`}
    >
      Agent: {state}
    </Badge>
  );
}
