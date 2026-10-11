import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/progress";
import {
  AgentStateBadge,
  agentStateFromStatus,
} from "@/components/agent-state";
import { Link } from "@tanstack/react-router";
import {
  Box,
  Camera,
  Clapperboard,
  ListChecks,
  RotateCcw,
  Square,
  X,
} from "lucide-react";

export type QueueJob = {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  name: string;
  projectId?: string;
  modelId?: string;
  projectName?: string;
  phase?: string;
  progress?: number;
};

const kindDetails: Record<string, { label: string; icon: typeof Box }> = {
  model: { label: "Model build", icon: Box },
  plan: { label: "Collection plan", icon: ListChecks },
  demo: { label: "Collection render", icon: Clapperboard },
  "project-photo": { label: "Project photography", icon: Camera },
  presentation: { label: "Saved version render", icon: Camera },
};

function jobTime(job: QueueJob) {
  const value = job.finishedAt || job.startedAt || job.createdAt;
  const label = job.finishedAt
    ? "Finished"
    : job.startedAt
      ? "Started"
      : "Added";

  return { label, value };
}

export function QueueJobCard({
  job,
  busy,
  onAction,
}: {
  job: QueueJob;
  busy: boolean;
  onAction: (path: string) => void;
}) {
  const kind = kindDetails[job.kind] || { label: job.kind, icon: Box };
  const Icon = kind.icon;
  const time = jobTime(job);
  const canCancel = ["queued", "running", "cancelling"].includes(job.status);
  const showProgress =
    ["running", "queued"].includes(job.status) &&
    ["model", "project-photo", "presentation"].includes(job.kind);

  return (
    <Card className="queue-job">
      <div className="queue-job-icon" data-kind={job.kind}>
        <Icon aria-hidden="true" />
      </div>
      <div className="queue-job-content">
        <div className="queue-job-heading">
          <div>
            <h3>{job.name}</h3>
            <div className="queue-job-meta">
              <span>{kind.label}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={time.value}>
                {time.label} {new Date(time.value).toLocaleString()}
              </time>
            </div>
          </div>
          <div className="queue-job-badges">
            <AgentStateBadge state={agentStateFromStatus(job.status)} />
            {["failed", "cancelled", "cancelling"].includes(job.status) && (
              <Badge variant="secondary" className={"badge " + job.status}>
                {job.status}
              </Badge>
            )}
          </div>
        </div>

        {job.projectId && (
          <Link
            className="queue-job-project"
            to="/projects/$projectId"
            params={{ projectId: job.projectId }}
          >
            {job.projectName}
          </Link>
        )}

        {showProgress && (
          <div className="queue-job-progress">
            <Progress
              value={job.progress || 0}
              label={job.phase || job.status}
              agentState={agentStateFromStatus(job.status)}
            />
          </div>
        )}

        {job.status === "failed" && (
          <div className="queue-failure-guidance">
            <p>
              {/timeout|timed out/i.test(job.error || "")
                ? "This job exceeded its time limit. Inspect its saved progress before resuming."
                : "This job stopped before finishing. Inspect its saved progress and error details to choose the next step."}
            </p>
            {job.projectId &&
              (job.modelId ? (
                <Button variant="outline" asChild>
                  <Link
                    to="/projects/$projectId/models/$modelId"
                    params={{ projectId: job.projectId, modelId: job.modelId }}
                    search={{ view: "3d", section: "activity" }}
                  >
                    Inspect model & recovery
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" asChild>
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: job.projectId }}
                  >
                    Open project & recovery
                  </Link>
                </Button>
              ))}
          </div>
        )}
        {job.error && (
          <details className="queue-job-error">
            <summary>Error details</summary>
            <p>{job.error}</p>
          </details>
        )}
      </div>

      {(canCancel ||
        (["project-photo", "presentation"].includes(job.kind) &&
          job.status === "failed")) && (
        <div className="queue-job-actions">
          {["project-photo", "presentation"].includes(job.kind) &&
          job.status === "failed" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onAction("queue/" + job.id + "/resume")}
            >
              <RotateCcw aria-hidden="true" />
              Resume
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onAction("queue/" + job.id + "/cancel")}
            >
              {job.status === "running" ? (
                <Square aria-hidden="true" />
              ) : (
                <X aria-hidden="true" />
              )}
              {job.status === "queued"
                ? "Remove"
                : job.status === "cancelling"
                  ? "Retry stop"
                  : "Stop"}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
