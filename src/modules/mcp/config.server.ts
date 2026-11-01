import { randomBytes } from "node:crypto";

export type McpConfig = {
  serverUrl: URL;
  /** Signs short-lived artifact download links; random per process unless MCP_SECRET is set. */
  signingSecret: string;
  /** Hostnames accepted in Host (DNS-rebinding defence). */
  allowedHostnames: string[];
  /** Hostnames accepted in Origin; requests without Origin (non-browser clients) pass. */
  allowedOrigins: string[];
};

type McpEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, "MCP_PUBLIC_URL" | "MCP_SECRET" | "MCP_ALLOWED_HOSTS" | "MCP_ALLOWED_ORIGINS">
>;

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
const processSecret = randomBytes(32).toString("hex");
const list = (value: string | undefined) => (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);

// Without MCP_PUBLIC_URL the endpoint follows the Host the request arrived on, which is
// checked against the allow-list below before any MCP work happens.
function publicUrl(environment: McpEnvironment, request?: Request) {
  if (environment.MCP_PUBLIC_URL) return environment.MCP_PUBLIC_URL;
  if (!request) throw new Error("MCP_PUBLIC_URL is required");
  const { protocol, host } = new URL(request.url);
  return `${protocol}//${request.headers.get("host") ?? host}/api/mcp`;
}

export function resolveMcpConfig(environment: McpEnvironment, request?: Request): McpConfig {
  const serverUrl = new URL(publicUrl(environment, request));
  if (serverUrl.protocol !== "https:" && serverUrl.protocol !== "http:")
    throw new Error("MCP_PUBLIC_URL must use HTTP(S)");
  if (serverUrl.pathname !== "/api/mcp" || serverUrl.search || serverUrl.hash || serverUrl.username || serverUrl.password)
    throw new Error("MCP_PUBLIC_URL must identify /api/mcp without credentials, query or fragment");
  const signingSecret = environment.MCP_SECRET ?? processSecret;
  if (signingSecret.length < 32) throw new Error("MCP_SECRET must contain at least 32 characters");
  // Only an explicit MCP_PUBLIC_URL or MCP_ALLOWED_HOSTS extends the loopback default; a
  // request-derived URL must not authorise its own Host header.
  const pinned = environment.MCP_PUBLIC_URL ? [serverUrl.hostname] : [];
  const allowedHostnames = [...new Set([...LOOPBACK, ...pinned, ...list(environment.MCP_ALLOWED_HOSTS)])];
  const allowedOrigins = [...new Set([...allowedHostnames, ...list(environment.MCP_ALLOWED_ORIGINS)])];
  return { serverUrl, signingSecret, allowedHostnames, allowedOrigins };
}

export function getMcpConfig(request?: Request) {
  return resolveMcpConfig({
    MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL,
    MCP_SECRET: process.env.MCP_SECRET,
    MCP_ALLOWED_HOSTS: process.env.MCP_ALLOWED_HOSTS,
    MCP_ALLOWED_ORIGINS: process.env.MCP_ALLOWED_ORIGINS,
  }, request);
}
