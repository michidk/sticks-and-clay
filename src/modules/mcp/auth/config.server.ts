export const MCP_READ_SCOPE = "sticks-and-clay:read";

export type McpConfig = {
  serverUrl: URL;
  issuer: URL;
  signingSecret: string;
  ownerAuth: { kind: "password"; password: string } | { kind: "hodor" };
  allowedHostnames: string[];
  allowedOrigins: string[];
  dangerouslyAllowInsecureUrls: boolean;
};

type McpEnvironment = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | "MCP_PUBLIC_URL"
    | "MCP_OWNER_PASSWORD"
    | "MCP_OWNER_AUTH"
    | "MCP_SECRET"
    | "MCP_ALLOWED_ORIGINS"
    | "HODOR_SECRET"
  >
>;

const first = (value: string | null) => value?.split(",")[0]?.trim();

// Without MCP_PUBLIC_URL the endpoint follows the public origin the request arrived on.
// The deployment's proxy must overwrite Host and X-Forwarded-* before they reach the app.
function publicUrl(environment: McpEnvironment, request?: Request) {
  if (environment.MCP_PUBLIC_URL) return environment.MCP_PUBLIC_URL;
  if (!request) throw new Error("MCP_PUBLIC_URL is required");
  const { protocol, host } = new URL(request.url);
  const proto = first(request.headers.get("x-forwarded-proto"));
  const origin = `${proto === "http" || proto === "https" ? proto : protocol.slice(0, -1)}://${first(request.headers.get("x-forwarded-host")) ?? request.headers.get("host") ?? host}`;
  return `${origin}/api/mcp`;
}

export function resolveMcpConfig(environment: McpEnvironment, request?: Request): McpConfig {
  const serverUrl = new URL(publicUrl(environment, request));
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    serverUrl.hostname,
  );
  if (
    serverUrl.protocol !== "https:" &&
    !(serverUrl.protocol === "http:" && loopback)
  )
    throw new Error("MCP_PUBLIC_URL must use HTTPS or loopback HTTP");
  if (
    serverUrl.pathname !== "/api/mcp" ||
    serverUrl.search ||
    serverUrl.hash ||
    serverUrl.username ||
    serverUrl.password
  )
    throw new Error(
      "MCP_PUBLIC_URL must identify /api/mcp without credentials, query or fragment",
    );
  // A Hodor deployment needs no MCP-specific secrets: Hodor already authenticates the owner.
  const hodorSecret = environment.HODOR_SECRET ?? "";
  const ownerMode =
    environment.MCP_OWNER_AUTH ??
    (!environment.MCP_OWNER_PASSWORD && hodorSecret ? "hodor" : "password");
  if (ownerMode !== "password" && ownerMode !== "hodor")
    throw new Error("MCP_OWNER_AUTH must be password or hodor");
  const ownerPassword = environment.MCP_OWNER_PASSWORD ?? "";
  if (ownerMode === "password" && ownerPassword.length < 32)
    throw new Error("MCP_OWNER_PASSWORD must contain at least 32 characters");
  const signingSecret = environment.MCP_SECRET ?? (ownerMode === "password" ? ownerPassword : hodorSecret);
  if (signingSecret.length < 32)
    throw new Error("MCP_SECRET must contain at least 32 characters");
  const allowedOrigins = (environment.MCP_ALLOWED_ORIGINS ?? "https://chatgpt.com")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const url = new URL(origin);
      if (
        url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )
      )
        throw new Error("MCP_ALLOWED_ORIGINS must use HTTPS or loopback HTTP");
      return url.origin;
    });
  return {
    serverUrl,
    issuer: new URL("/", serverUrl),
    signingSecret,
    ownerAuth: ownerMode === "hodor" ? { kind: "hodor" } : { kind: "password", password: ownerPassword },
    // The managed preview gateway forwards to a fixed loopback Host.
    allowedHostnames: [...new Set([serverUrl.hostname, "localhost", "127.0.0.1", "[::1]"])],
    allowedOrigins,
    dangerouslyAllowInsecureUrls: loopback,
  };
}

export function getMcpConfig(request?: Request) {
  return resolveMcpConfig({
    HODOR_SECRET: process.env.HODOR_SECRET,
    MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL,
    MCP_OWNER_PASSWORD: process.env.MCP_OWNER_PASSWORD,
    MCP_OWNER_AUTH: process.env.MCP_OWNER_AUTH,
    MCP_SECRET: process.env.MCP_SECRET,
    MCP_ALLOWED_ORIGINS: process.env.MCP_ALLOWED_ORIGINS,
  }, request);
}
