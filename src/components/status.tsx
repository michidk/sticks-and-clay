import { LoaderCircle } from "lucide-react";
import { Badge } from "./ui/badge";
import { Progress as ProgressBar } from "./ui/progress";

export type Tone = "done" | "running" | "failed" | "warning" | "queued";

const terminal = new Set(["done", "completed", "ready", "failed", "cancelled"]);

/** One mapping from workflow status (plus optional verdict) to colour and label. */
export function statusInfo(status: string, verdict?: string | null) {
  if (verdict === "limit_reached")
    return { tone: "warning" as Tone, label: "Completed with issues" };
  if (verdict === "approved" && status === "done")
    return { tone: "done" as Tone, label: "Approved" };
  if (status === "failed") return { tone: "failed" as Tone, label: "Failed" };
  if (status === "cancelled")
    return { tone: "queued" as Tone, label: "Cancelled" };
  if (status === "review")
    return { tone: "warning" as Tone, label: "Review design" };
  if (status === "queued") return { tone: "queued" as Tone, label: "Queued" };
  if (status === "done") return { tone: "done" as Tone, label: "Complete" };
  const label = status.replaceAll("_", " ");
  return {
    tone: (terminal.has(status) ? "done" : "running") as Tone,
    label: label[0].toUpperCase() + label.slice(1),
  };
}

export function StatusBadge({
  status,
  verdict,
  tone,
  children,
  className = "",
}: {
  status?: string;
  verdict?: string | null;
  tone?: Tone;
  children?: React.ReactNode;
  className?: string;
}) {
  const info = status ? statusInfo(status, verdict) : undefined;
  const resolvedTone = tone || info?.tone || "queued";
  return (
    <Badge
      variant="secondary"
      className={`badge ${resolvedTone} ${className}`.trim()}
    >
      {resolvedTone === "running" && (
        <LoaderCircle size={11} className="spin" aria-hidden="true" />
      )}
      {children ?? info?.label}
    </Badge>
  );
}

export function Progress({
  value,
  label,
  status,
}: {
  value: number;
  label: string;
  status?: string;
}) {
  const tone = status ? statusInfo(status).tone : "running";
  return (
    <div className="progress-wrap" data-tone={tone}>
      <div className="progress-label">
        <span>
          {tone === "running" && (
            <LoaderCircle size={12} className="spin" aria-hidden="true" />
          )}
          {label}
        </span>
        <span>{Math.round(value)}%</span>
      </div>
      <ProgressBar
        aria-label={label}
        value={Math.min(100, Math.max(0, value))}
        className="h-1.5"
      />
    </div>
  );
}
