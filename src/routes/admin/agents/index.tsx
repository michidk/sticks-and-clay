import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { request } from "../../../lib/client";
import { CardsSkeleton } from "../../../components/loading";
export const Route = createFileRoute("/admin/agents/")({
  component: AgentsPage,
});
function AgentsPage() {
  const [agents, setAgents] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    request("agents")
      .then((r) => setAgents(r.agents))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main>
      <div className="eyebrow">ADMINISTRATION</div>
      <section className="page-heading">
        <div>
          <h1>Agents & AI roles</h1>
          <p className="lede">
            Execution settings for new requests. Existing sessions retain their
            saved settings.
          </p>
        </div>
        <Link to="/admin/queue">Generation queue</Link>
      </section>
      <p className="note">
        Configured in src/modules/ai/roles.ts. Prompt files live in prompts/.
        Settings are read-only here.
      </p>
      {error && (
        <Alert variant="destructive" role="alert" className="error">
          {error}
        </Alert>
      )}
      {!agents && !error && (
        <CardsSkeleton label="Loading agent settings" covers={false} />
      )}
      <div className="project-grid">
        {agents?.map((agent) => (
          <Card className="panel" key={agent.id}>
            <h2>{agent.id}</h2>
            <Badge variant="secondary" className="badge">
              {agent.engine === "eve"
                ? "Eve · resumable session"
                : "TanStack AI · one-shot"}
            </Badge>
            <dl className="role-settings">
              <dt>Model</dt>
              <dd>{agent.model}</dd>
              <dt>Reasoning effort</dt>
              <dd>{agent.effort}</dd>
              <dt>Instructions</dt>
              <dd>prompts/{agent.prompt}.md</dd>
              <dt>Input template</dt>
              <dd>prompts/{agent.inputTemplate}.md</dd>
            </dl>
          </Card>
        ))}
      </div>
      <Card className="panel">
        <h2>Texture generation</h2>
        <p>
          Builders can call the Codex imagegen skill through generate_texture.
          Generated and derived texture images are retained with each model
          version. Image requests have separate history and usage records.
        </p>
      </Card>
    </main>
  );
}
