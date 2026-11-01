import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse } from "@modelcontextprotocol/server";
import { z } from "zod";
import { readStoredFile } from "../../lib/storage.server";
import { fileMimeType } from "../../lib/storage/path";
import { artifactKey } from "./artifacts.server";
import { getMcpConfig, type McpConfig } from "./config.server";
import { MAX_MCP_BODY_BYTES, MCP_SCOPE_VALUES } from "./catalog";
import { createStudioMcpServer } from "./tools.server";
import { defaultMcpPolicy, loadMcpPolicy, recordMcpAudit, type McpPolicy } from "./settings.server";
import { api } from "../../lib/api.server";
import type { AppApi } from "./api.server";
import { createArtifactDownload, verifyArtifactDownload } from "./downloads.server";

const MCP_PATH = "/api/mcp";
const FILE_PREFIX = `${MCP_PATH}/files/`;
const callEnvelope = z.object({ method: z.literal("tools/call"), params: z.object({ name: z.string().max(200) }) });
const failedResult = z.object({ error: z.unknown().optional(), result: z.object({ isError: z.boolean().optional() }).optional() });

export function handlesMcpHttpPath(path: string) {
  return path === MCP_PATH || path.startsWith(FILE_PREFIX);
}

async function readBody(request: Request, limit: number): Promise<{ body: unknown } | Response> {
  if (!request.body) return { body: undefined };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return Response.json({ error: "Request body exceeds the MCP upload limit" }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
    try { return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }; }
    catch { return Response.json({ error: "Invalid JSON request" }, { status: 400 }); }
  } finally { reader.releaseLock(); }
}

async function auditOutcome(response: Response) {
  if (!response.ok) return "failure";
  try {
    const text = await response.clone().text();
    const payload = response.headers.get("content-type")?.includes("text/event-stream")
      ? JSON.parse(text.split("\n").reverse().find((line) => line.startsWith("data: "))?.slice(6) ?? "null")
      : JSON.parse(text);
    const parsed = failedResult.safeParse(payload);
    return parsed.success && (parsed.data.error || parsed.data.result?.isError) ? "failure" : "success";
  } catch { return "failure"; }
}


export function createMcpHttpHandler(config: McpConfig, options: {
  api?: AppApi;
  readFile?: typeof readStoredFile;
  policy?: () => Promise<McpPolicy>;
  audit?: typeof recordMcpAudit;
} = {}) {
  const loadPolicy = options.policy ?? (async () => defaultMcpPolicy);
  const audit = options.audit ?? recordMcpAudit;
  // createMcpHandler is stateless: every request builds a fresh server, no session ids or SSE streams are kept.
  const protocol = createMcpHandler(({ authInfo }) => createStudioMcpServer({
    scopes: MCP_SCOPE_VALUES, publicUrl: config.serverUrl, api: options.api ?? api, readFile: options.readFile,
    disabledTools: new Set((authInfo?.extra?.disabledTools as string[] | undefined) ?? []),
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
    const parsed = request.method === "POST" ? await readBody(request, MAX_MCP_BODY_BYTES) : { body: undefined };
    if (parsed instanceof Response) return parsed;
    const call = callEnvelope.safeParse(parsed.body);
    const response = await protocol.fetch(request, {
      authInfo: { token: "", clientId: "local", scopes: [...MCP_SCOPE_VALUES], extra: { disabledTools: policy.disabledTools } },
      parsedBody: parsed.body,
    });
    if (call.success) {
      try { await audit({ event: "tool_called", toolName: call.data.params.name, outcome: await auditOutcome(response) }); }
      catch { console.error("[Sticks & Clay] MCP audit persistence failed"); }
    }
    return response;
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
