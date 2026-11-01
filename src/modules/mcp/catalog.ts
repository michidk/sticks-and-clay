export const MAX_MCP_BODY_BYTES = 280 * 1024 * 1024;

/** Each tool belongs to one level; the owner picks the highest level assistants may use. */
export const MCP_LEVELS = ["read", "write", "admin"] as const;
export type McpLevel = (typeof MCP_LEVELS)[number];
