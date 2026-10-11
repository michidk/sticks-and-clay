import { z } from "zod";

export const MAX_MCP_BODY_BYTES = 280 * 1024 * 1024;

export const MCP_SCOPE_VALUES = [
  "sticks-and-clay:read",
  "sticks-and-clay:write",
  "sticks-and-clay:admin",
] as const;
export const mcpScopeSchema = z.enum(MCP_SCOPE_VALUES);
export type McpScope = z.infer<typeof mcpScopeSchema>;
export const MCP_SCOPE_DETAILS: Record<McpScope, { label: string; description: string }> = {
  "sticks-and-clay:read": {
    label: "Read projects and assets",
    description: "Read designs, assets, source bundles, renders, revisions, agent history, costs and job progress.",
  },
  "sticks-and-clay:write": {
    label: "Create and change assets",
    description: "Create projects, approve designs, generate and import assets, revise materials, render sprites, and control jobs. Generation can spend money with your model provider and execute Blender scripts.",
  },
  "sticks-and-clay:admin": {
    label: "Manage the workshop",
    description: "Change models, runtime limits and queue settings, inspect diagnostics, and revoke connected clients.",
  },
};
