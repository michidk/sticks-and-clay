import { createFileRoute } from "@tanstack/react-router";
import { DiagnosticsPanel } from "./-components/diagnostics-panel";

export const Route = createFileRoute("/admin/diagnostics/")({ component: DiagnosticsPage });

function DiagnosticsPage() {
  return <div className="admin-page diagnostics-page">
    <section className="page-heading">
      <div>
        <h1>System diagnostics</h1>
        <p className="lede">Live service health, capacity, effective configuration, and recent operational failures.</p>
      </div>
    </section>
    <DiagnosticsPanel />
  </div>;
}
