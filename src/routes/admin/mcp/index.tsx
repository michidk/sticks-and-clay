import { createFileRoute } from "@tanstack/react-router";
import { McpSettings } from "./-components/mcp-settings";

export const Route = createFileRoute("/admin/mcp/")({ component: McpPage });

function McpPage() {
  return <div className="admin-page">
    <section className="page-heading">
      <div>
        <h1>AI access</h1>
        <p className="lede">Control what connected assistants such as ChatGPT, Claude and Codex can read or change through MCP. OAuth scopes and the switches below are enforced on every request.</p>
      </div>
    </section>
    <McpSettings />
  </div>;
}
