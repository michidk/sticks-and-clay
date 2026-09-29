import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { request } from "../../../lib/client";
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
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!agents && !error && <p role="status">Loading settings…</p>}
      <div className="project-grid">
        {agents?.map((agent) => (
          <article className="panel" key={agent.id}>
            <h2>{agent.id}</h2>
            <p className="badge">
              {agent.engine === "eve"
                ? "Eve · resumable session"
                : "TanStack AI · one-shot"}
            </p>
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
          </article>
        ))}
      </div>
      <section className="panel">
        <h2>Texture generation</h2>
        <p>
          Builders can call the Codex imagegen skill through generate_texture.
          Generated and derived texture images are retained with each model
          version. Image requests have separate history and usage records.
        </p>
      </section>
    </main>
  );
}
