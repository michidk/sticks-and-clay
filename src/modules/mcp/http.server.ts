import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse } from "@modelcontextprotocol/server";
import { readStoredFile } from "../../lib/storage.server";
import { fileMimeType } from "../../lib/storage/path";
import { artifactKey } from "./artifacts.server";
import { getMcpConfig, type McpConfig } from "./config.server";
import { MAX_MCP_BODY_BYTES } from "./catalog";
import { createStudioMcpServer } from "./tools.server";
import { defaultMcpPolicy, loadMcpPolicy, recordMcpAudit, type McpPolicy } from "./settings.server";
import { api } from "../../lib/api.server";
import type { AppApi } from "./api.server";
import { createArtifactDownload, verifyArtifactDownload } from "./downloads.server";

const MCP_PATH = "/api/mcp";
const FILE_PREFIX = `${MCP_PATH}/files/`;

export function handlesMcpHttpPath(path: string) {
  return path === MCP_PATH || path.startsWith(FILE_PREFIX);
}

export function createMcpHttpHandler(config: McpConfig, options: {
  api?: AppApi;
  readFile?: typeof readStoredFile;
  policy?: () => Promise<McpPolicy>;
  audit?: typeof recordMcpAudit;
} = {}) {
  const loadPolicy = options.policy ?? (async () => defaultMcpPolicy);
  const audit = options.audit ?? recordMcpAudit;
  // Stateless: every request builds a fresh server carrying the owner's current tool policy.
  const protocol = createMcpHandler(async () => createStudioMcpServer({
    publicUrl: config.serverUrl, api: options.api ?? api, readFile: options.readFile, audit,
    disabledTools: new Set((await loadPolicy()).disabledTools),
    createDownload: async (key) => createArtifactDownload(key, config),
  }), { maxRequestBodySize: MAX_MCP_BODY_BYTES });

  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname;
    if (!handlesMcpHttpPath(path)) return null;
    const rejected = hostHeaderValidationResponse(request, config.allowedHostnames)
      ?? originValidationResponse(request, config.allowedOrigins);
    if (rejected) return rejected;
    const policy = await loadPolicy();
    if (!policy.enabled) return Response.json(
      { error: "mcp_disabled", error_description: "MCP access is paused by the owner" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
    if (path.startsWith(FILE_PREFIX)) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
      let key: string;
      try { key = artifactKey.parse(decodeURIComponent(path.slice(FILE_PREFIX.length))); }
      catch { return new Response("Invalid artifact key", { status: 400 }); }
      const ticket = new URL(request.url).searchParams.get("ticket");
      if (!ticket || !verifyArtifactDownload(ticket, key, config)) return new Response("Invalid or expired download link", {
        status: 401, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      });
      try {
        const blob = await (options.readFile ?? readStoredFile)(key);
        return new Response(blob, { headers: {
          "Content-Type": fileMimeType(key), "Content-Length": String(blob.size),
          "Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer",
        } });
      } catch { return new Response("Artifact unavailable", { status: 404 }); }
    }
    return protocol.fetch(request);
  };
}

const liveHandlers = new Map<string, ReturnType<typeof createMcpHttpHandler>>();
export async function handleMcpHttpRequest(request: Request): Promise<Response | null> {
  if (!handlesMcpHttpPath(new URL(request.url).pathname)) return null;
  try {
    const config = getMcpConfig(request);
    let handler = liveHandlers.get(config.serverUrl.href);
    if (!handler) liveHandlers.set(config.serverUrl.href, handler = createMcpHttpHandler(config, { policy: loadMcpPolicy }));
    return await handler(request);
  } catch {
    console.error("[Sticks & Clay] MCP service unavailable");
    return Response.json({ error: "server_error", error_description: "MCP service is unavailable; check configuration and database migrations" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
