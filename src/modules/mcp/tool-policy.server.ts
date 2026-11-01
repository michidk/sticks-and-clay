import type { McpServer } from "@modelcontextprotocol/server";

export type McpToolAudit = (event: { event: "tool_called"; toolName: string; outcome: "success" | "failure" }) => Promise<void>;

type Register = (name: string, config: unknown, callback: (...args: unknown[]) => unknown) => { disable(): void };

/**
 * Applies the owner's tool policy to every tool registered afterwards: disabled tools are
 * hidden from discovery and calls, and each call is audited by its own outcome.
 * Call before registering tools. Keep this file identical across apps.
 */
export function applyToolPolicy(server: McpServer, options: { disabledTools?: ReadonlySet<string>; audit?: McpToolAudit }) {
  const register = server.registerTool.bind(server) as unknown as Register;
  (server as unknown as { registerTool: Register }).registerTool = (name, config, callback) => {
    const tool = register(name, config, async (...args) => {
      let outcome: "success" | "failure" = "failure";
      try {
        const response = await callback(...args);
        outcome = (response as { isError?: boolean } | undefined)?.isError ? "failure" : "success";
        return response;
      } finally {
        await options.audit?.({ event: "tool_called", toolName: name, outcome }).catch(() => console.error("MCP audit persistence failed"));
      }
    });
    if (options.disabledTools?.has(name)) tool.disable();
    return tool;
  };
}
