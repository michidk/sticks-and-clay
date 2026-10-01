import { AgentStateBadge, type AgentState } from "./agent-state";
import { Progress as ProgressBar } from "./ui/progress";

export function Progress({
  value,
  label,
  agentState,
}: {
  value: number;
  label: string;
  agentState: AgentState;
}) {
  return (
    <div className="progress-wrap">
      <div className="progress-label">
        <span>{label}</span>
        <span className="progress-status">
          <AgentStateBadge state={agentState} />
          <span>{value}%</span>
        </span>
      </div>
      <ProgressBar
        aria-label={label}
        value={Math.min(100, Math.max(0, value))}
        className="h-1.5"
      />
    </div>
  );
}
