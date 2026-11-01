import { createFileRoute } from "@tanstack/react-router";
import { McpSettings } from "./-components/mcp-settings";

export const Route = createFileRoute("/admin/mcp/")({ component: McpPage });

function McpPage() {
  return <div className="admin-page">
    <section className="page-heading">
      <div>
        <h1>MCP</h1>
        <p className="lede">Choose what connected assistants such as ChatGPT, Claude and Codex can do.</p>
      </div>
    </section>
    <McpSettings />
  </div>;
}
