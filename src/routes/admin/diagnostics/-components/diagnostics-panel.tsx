import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { request } from "@/lib/client";
import type { RuntimeSettings } from "@/lib/contracts";
import { Activity, Bot, Box, Database, HardDrive, Server } from "lucide-react";
import { useEffect, useState } from "react";

type Health = { status: string; latencyMs?: number | null };
type Diagnostics = {
  checkedAt: string;
  services: {
    database: Health;
    worker: Health & { activeJobs: number; paused: boolean; configuredConcurrency: number; effectiveConcurrency: number; lastSeenAt: string | null };
    eve: Health;
    blender: Health;
    storage: Health & { provider: string; objectCount: number | null; usedBytes: number | null; availableBytes: number | null };
  };
  recentFailures: { kind: string; finishedAt: string | null }[];
  effectiveSettings: RuntimeSettings;
  restartRequired: string[];
};
const bytes = (value: number | null) => value === null ? "Unavailable" : `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;

export function DiagnosticsPanel() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () => request<Diagnostics>("diagnostics")
      .then((result) => { if (active) { setData(result); setError(""); } })
      .catch((cause) => { if (active) setError(cause.message); });
    void load();
    const timer = setInterval(load, 10_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  if (!data && !error) return <div className="diagnostics-grid">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-40 rounded-xl" />)}</div>;
  return <>
    {error && <Alert variant="destructive" className="error"><AlertDescription>{error}</AlertDescription></Alert>}
    {data && <>
      <div className="diagnostics-grid">
        <ServiceCard name="Database" icon={Database} health={data.services.database} detail="Application persistence" />
        <ServiceCard name="Worker" icon={Server} health={data.services.worker} detail={`${data.services.worker.activeJobs} active · ${data.services.worker.paused ? "claims paused" : `${data.services.worker.effectiveConcurrency} lanes`}`} />
        <ServiceCard name="Eve" icon={Bot} health={data.services.eve} detail="Resumable agent sessions" />
        <ServiceCard name="Blender" icon={Box} health={data.services.blender} detail="Isolated 3D execution" />
        <ServiceCard name="Storage" icon={HardDrive} health={data.services.storage} detail={`${data.services.storage.provider} · ${data.services.storage.objectCount ?? "—"} objects`} />
      </div>
      <div className="diagnostics-details">
        <Card className="panel diagnostics-detail-card">
          <h2>Storage</h2>
          <dl><div><dt>Tracked usage</dt><dd>{bytes(data.services.storage.usedBytes)}</dd></div><div><dt>Available locally</dt><dd>{bytes(data.services.storage.availableBytes)}</dd></div></dl>
        </Card>
        <Card className="panel diagnostics-detail-card">
          <h2>Recent failed jobs</h2>
          {data.recentFailures.length ? <ul>{data.recentFailures.map((failure, index) => <li key={`${failure.kind}-${index}`}><strong>{failure.kind}</strong><span>{failure.finishedAt ? new Date(failure.finishedAt).toLocaleString() : "Time unavailable"}</span></li>)}</ul> : <p className="note">No recent failed jobs.</p>}
        </Card>
        <Card className="panel diagnostics-detail-card">
          <h2>Runtime summary</h2>
          <dl><div><dt>Queue</dt><dd>{data.effectiveSettings.queue.paused ? "Paused" : `${data.effectiveSettings.queue.concurrency} lanes`}</dd></div><div><dt>Agent timeout</dt><dd>{data.effectiveSettings.timeouts.agentMs / 60_000} min</dd></div><div><dt>Default batch</dt><dd>{data.effectiveSettings.generationDefaults.count} assets</dd></div><div><dt>Restart required</dt><dd>{data.restartRequired.length ? data.restartRequired.join(", ") : "None"}</dd></div></dl>
        </Card>
      </div>
      <p className="diagnostics-updated"><Activity aria-hidden="true" /> Checked {new Date(data.checkedAt).toLocaleTimeString()}. Endpoints, credentials, process IDs, and internal paths are intentionally omitted.</p>
    </>}
  </>;
}

function ServiceCard({ name, icon: Icon, health, detail }: { name: string; icon: typeof Activity; health: Health; detail: string }) {
  const healthy = health.status === "healthy";
  return <Card className="diagnostic-card" data-status={health.status}>
    <div className="diagnostic-card-icon"><Icon aria-hidden="true" /></div>
    <div><div className="diagnostic-card-heading"><h2>{name}</h2><Badge variant="secondary">{healthy ? "Healthy" : health.status === "degraded" ? "Degraded" : "Unavailable"}</Badge></div><p>{detail}</p>{health.latencyMs !== undefined && <small>{health.latencyMs === null ? "No response" : `${health.latencyMs} ms response`}</small>}</div>
  </Card>;
}
