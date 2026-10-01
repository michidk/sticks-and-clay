import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Info,
  Pause,
  Play,
  XCircle,
} from "lucide-react";
import { request, json } from "../../../lib/client";
import { QueueSkeleton } from "../../../components/loading";
import {
  QueueJobCard,
  type QueueJob,
} from "./-components/queue-job-card";
import "./-components/queue.css";

export const Route = createFileRoute("/admin/queue/")({ component: QueuePage });
type QueueControl = {
  paused: boolean;
  concurrency: number;
  activeJobs: number;
  workerHealthy: boolean;
};
function QueuePage() {
  const [jobs, setJobs] = useState<QueueJob[]>([]),
    [control, setControl] = useState<QueueControl | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const result = await request<{ jobs: QueueJob[]; control: QueueControl }>("queue");
    setJobs(result.jobs);
    setControl(result.control);
    setLoading(false);
  };
  useEffect(() => {
    void load().catch((e) => {
      setError(e.message);
      setLoading(false);
    });
    const t = setInterval(
      () => void load().catch((e) => setError(e.message)),
      2500,
    );
    return () => clearInterval(t);
  }, []);
  async function cancel(path: string) {
    setBusy(true);
    setError("");
    try {
      await request(path, json({}));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function updateControl(patch: Partial<Pick<QueueControl, "paused" | "concurrency">>) {
    setBusy(true);
    setError("");
    try {
      await request("settings", json({ queue: patch }, "PATCH"));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = jobs.filter((j) =>
    ["queued", "running", "cancelling"].includes(j.status),
  );
  const running = jobs.filter((j) =>
    ["running", "cancelling"].includes(j.status),
  );
  const queued = jobs.filter((j) => j.status === "queued");
  const attention = jobs.filter((j) => j.status === "failed");
  const history = jobs.filter((j) => !active.includes(j) && j.status !== "failed");
  const summary = [
    { label: "In progress", value: running.length, tone: "running", icon: Activity },
    { label: "Waiting", value: queued.length, tone: "warning", icon: Clock3 },
    {
      label: "Completed",
      value: jobs.filter((j) => j.status === "done").length,
      tone: "done",
      icon: CheckCircle2,
    },
    {
      label: "Needs attention",
      value: jobs.filter((j) => j.status === "failed").length,
      tone: "failed",
      icon: AlertTriangle,
    },
  ] as const;

  return (
    <div className="admin-page queue-page">
      <section className="page-heading queue-heading">
        <div>
          <h1>Generation queue</h1>
          <p className="lede">
            Model builders, photography, reviews, planning, and collection
            renders.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy || queued.length === 0}
          onClick={() => cancel("queue/cancel-pending")}
        >
          <XCircle aria-hidden="true" />
          Cancel waiting jobs
        </Button>
      </section>
      {error && (
        <Alert variant="destructive" role="alert" className="error">
          {error}
        </Alert>
      )}
      {control && (
        <Card className="queue-control-card">
          <div className="queue-control-status" data-paused={control.paused}>
            <span>{control.paused ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</span>
            <div>
              <strong>{control.paused ? "Queue paused" : "Queue accepting work"}</strong>
              <small>{control.activeJobs} active · worker {control.workerHealthy ? "online" : "not reporting"}</small>
            </div>
          </div>
          <div className="queue-control-actions">
            <label>
              Concurrent jobs
              <Select value={String(control.concurrency)} disabled={busy}
                onValueChange={(value) => updateControl({ concurrency: Number(value) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[1, 2, 3, 4].map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <Button variant={control.paused ? "default" : "outline"} disabled={busy}
              onClick={() => updateControl({ paused: !control.paused })}>
              {control.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              {control.paused ? "Resume claims" : "Pause claims"}
            </Button>
          </div>
        </Card>
      )}
      {loading ? (
        <QueueSkeleton />
      ) : (
        <div className="queue-summary" aria-label="Queue summary">
          {summary.map(({ label, value, tone, icon: Icon }) => (
            <div className="queue-stat" data-tone={tone} key={label}>
              <span className="queue-stat-icon">
                <Icon aria-hidden="true" />
              </span>
              <div>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="queue-guidance">
        <Info aria-hidden="true" />
        <span>
          Brief generation runs immediately and does not appear here. Stop
          requests can take a moment while an active Blender operation exits.
        </span>
      </p>
      {!loading && (
        <>
          {!!attention.length && <QueueSection title="Needs attention" description="Inspect failed work and choose how to recover it." jobs={attention} busy={busy} onAction={cancel} empty="No failed jobs." />}
          <QueueSection
            title="Active queue"
            description={`${active.length} ${active.length === 1 ? "job" : "jobs"} in progress or waiting`}
            jobs={active}
            busy={busy}
            onAction={cancel}
            empty="The queue is clear. New generation work will appear here."
          />
          <QueueSection
            title="Recent history"
            description={`${history.length} completed or stopped ${history.length === 1 ? "job" : "jobs"}`}
            jobs={history}
            busy={busy}
            onAction={cancel}
            empty="No completed jobs yet."
          />
        </>
      )}
    </div>
  );
}

function QueueSection({
  title,
  description,
  jobs,
  busy,
  onAction,
  empty,
}: {
  title: string;
  description: string;
  jobs: QueueJob[];
  busy: boolean;
  onAction: (path: string) => void;
  empty: string;
}) {
  return (
    <section className="queue-section">
      <div className="queue-section-heading">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {jobs.length ? (
        <div className="queue-job-list">
          {jobs.map((job) => (
            <QueueJobCard
              key={job.id}
              job={job}
              busy={busy}
              onAction={onAction}
            />
          ))}
        </div>
      ) : (
        <p className="queue-empty">{empty}</p>
      )}
    </section>
  );
}
