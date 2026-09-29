import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { request, json } from "../../../lib/client";
import { Progress } from "../../../components/progress";
import { QueueSkeleton } from "../../../components/loading";
export const Route = createFileRoute("/admin/queue/")({ component: QueuePage });
function QueuePage() {
  const [jobs, setJobs] = useState<any[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const load = async () => {
    setJobs((await request("queue")).jobs);
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
  const active = jobs.filter((j) =>
    ["queued", "running", "cancelling"].includes(j.status),
  );
  return (
    <main>
      <div className="eyebrow">ADMINISTRATION</div>
      <section className="page-heading">
        <div>
          <h1>Generation queue</h1>
          <p className="lede">
            Model builders, photography, reviews, planning, and collection
            renders.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy || !jobs.some((j) => j.status === "queued")}
          onClick={() => cancel("queue/cancel-pending")}
        >
          Abort pending queue
        </Button>
      </section>
      {error && (
        <Alert variant="destructive" role="alert" className="error">
          {error}
        </Alert>
      )}
      {loading ? (
        <QueueSkeleton />
      ) : (
        <p>
          {active.length} active jobs ·{" "}
          {jobs.filter((j) => j.status === "queued").length} waiting
        </p>
      )}
      <p className="note">
        Brief buttons call TanStack AI directly and never enter this queue.
        Stopping a running job requests cancellation; it may take time for an
        active Blender operation to stop.
      </p>
      {!loading &&
        ["Active", "History"].map((section) => (
          <section key={section}>
            <h2>{section}</h2>
            {jobs
              .filter((j) =>
                section === "Active" ? active.includes(j) : !active.includes(j),
              )
              .map((j) => (
                <Card className="panel" key={j.id}>
                  <div className="section-title">
                    <div>
                      <h3>{j.name}</h3>
                      {j.projectId && (
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: j.projectId }}
                        >
                          {j.projectName}
                        </Link>
                      )}
                    </div>
                    <Badge variant="secondary" className={"badge " + j.status}>
                      {j.status}
                    </Badge>
                  </div>
                  <p>
                    {j.kind} · {new Date(j.createdAt).toLocaleString()}
                  </p>
                  {["running", "queued"].includes(j.status) &&
                    ["model", "project-photo"].includes(j.kind) && (
                      <Progress
                        value={j.progress || 0}
                        label={j.phase || j.status}
                      />
                    )}
                  {j.error && <p className="muted">{j.error}</p>}
                  {j.kind === "project-photo" && j.status === "failed" && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => cancel("queue/" + j.id + "/resume")}
                    >
                      Resume photography
                    </Button>
                  )}
                  {["queued", "running", "cancelling"].includes(j.status) && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => cancel("queue/" + j.id + "/cancel")}
                    >
                      {j.status === "queued"
                        ? "Remove from queue"
                        : j.status === "cancelling"
                          ? "Retry stop request"
                          : "Stop job"}
                    </Button>
                  )}
                </Card>
              ))}
          </section>
        ))}
    </main>
  );
}
