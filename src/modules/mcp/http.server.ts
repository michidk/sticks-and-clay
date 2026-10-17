import {
  createMcpHandler, getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse, requireBearerAuth,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { readStoredFile } from "../../lib/storage.server";
import { fileMimeType } from "../../lib/storage/path";
import { artifactKey } from "./artifacts.server";
import { createLocalTokenVerifier } from "./auth/auth.server";
import { getMcpConfig, MCP_READ_SCOPE, type McpConfig } from "./auth/config.server";
import { createOAuthHttpHandler, handlesOAuthPath } from "./auth/oauth-http.server";
import { DrizzleOAuthStore, type OAuthStore } from "./auth/oauth-store.server";
import { MAX_MCP_BODY_BYTES, MCP_SCOPE_VALUES } from "./catalog";
import { createStudioMcpServer } from "./tools.server";
import { defaultMcpPolicy, loadMcpPolicy, type McpPolicy } from "./settings.server";
import type { AppApi } from "./api.server";

const MCP_PATH = "/api/mcp";
const FILE_PREFIX = `${MCP_PATH}/files/`;
const callEnvelope = z.object({ method: z.literal("tools/call"), params: z.object({ name: z.string().max(200) }) });
const failedResult = z.object({ error: z.unknown().optional(), result: z.object({ isError: z.boolean().optional() }).optional() });

export function handlesMcpHttpPath(path: string) {
  return path === MCP_PATH || path.startsWith(FILE_PREFIX) || handlesOAuthPath(path);
}

function cors(response: Response, origin: string | null) {
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.append("Vary", "Origin");
  headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Protocol-Version");
  return new Response(response.body, { status: response.status, headers });
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

export function createMcpHttpHandler(config: McpConfig, store: OAuthStore, options: {
  api?: AppApi;
  readFile?: typeof readStoredFile;
  policy?: () => Promise<McpPolicy>;
} = {}) {
  const loadPolicy = options.policy ?? (async () => defaultMcpPolicy);
  const oauth = createOAuthHttpHandler(config, store);
  const protocol = createMcpHandler(({ authInfo }) => createStudioMcpServer({
    scopes: authInfo?.scopes ?? [], publicUrl: config.serverUrl, store, api: options.api, readFile: options.readFile,
    disabledTools: new Set((authInfo?.extra?.disabledTools as string[] | undefined) ?? []),
  }), { maxRequestBodySize: MAX_MCP_BODY_BYTES });
  const authenticate = requireBearerAuth({
    verifier: createLocalTokenVerifier(config, store), requiredScopes: [MCP_READ_SCOPE],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.serverUrl),
  });

  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname;
    if (!handlesMcpHttpPath(path)) return null;
    const rejectedHost = hostHeaderValidationResponse(request, config.allowedHostnames);
    if (rejectedHost) return rejectedHost;
    const policy = await loadPolicy();
    if (!policy.enabled) return Response.json(
      { error: "mcp_disabled", error_description: "MCP access is paused by the owner" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
    if (handlesOAuthPath(path)) return oauth(request);
    const origin = request.headers.get("origin");
    if (origin && ![config.issuer.origin, ...config.allowedOrigins].includes(origin))
      return new Response("Forbidden origin", { status: 403 });
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, MCP-Method, MCP-Name",
      "Access-Control-Max-Age": "86400",
    } }), origin);
    const auth = await authenticate(request);
    if (auth instanceof Response) {
      const headers = new Headers(auth.headers);
      const challenge = headers.get("WWW-Authenticate");
      // Clients use the challenge to request permissions; consent chooses the actual grant.
      if (challenge) headers.set("WWW-Authenticate", challenge.replace(/scope="[^"]*"/, `scope="${MCP_SCOPE_VALUES.join(" ")}"`));
      return cors(new Response(auth.body, { status: auth.status, headers }), origin);
    }
    if (path.startsWith(FILE_PREFIX)) {
      if (request.method !== "GET") return cors(new Response("Method not allowed", { status: 405, headers: { Allow: "GET, OPTIONS" } }), origin);
      let key: string;
      try { key = artifactKey.parse(decodeURIComponent(path.slice(FILE_PREFIX.length))); }
      catch { return cors(new Response("Invalid artifact key", { status: 400 }), origin); }
      try {
        const blob = await (options.readFile ?? readStoredFile)(key);
        return cors(new Response(blob, { headers: {
          "Content-Type": fileMimeType(key), "Content-Length": String(blob.size),
          "Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
        } }), origin);
      } catch { return cors(new Response("Artifact unavailable", { status: 404 }), origin); }
    }
    const parsed = request.method === "POST"
      ? await readBody(request, auth.scopes.includes("sticks-and-clay:write") ? MAX_MCP_BODY_BYTES : 4 * 1024 * 1024)
      : { body: undefined };
    if (parsed instanceof Response) return cors(parsed, origin);
    const call = callEnvelope.safeParse(parsed.body);
    const response = await protocol.fetch(request, { authInfo: { ...auth, extra: { disabledTools: policy.disabledTools } }, parsedBody: parsed.body });
    if (call.success) {
      try { await store.audit({ event: "tool_called", clientId: auth.clientId, toolName: call.data.params.name, outcome: await auditOutcome(response) }); }
      catch { console.error("[Sticks & Clay] MCP audit persistence failed"); }
    }
    return cors(response, origin);
  };
}

const liveHandlers = new Map<string, ReturnType<typeof createMcpHttpHandler>>();
export async function handleMcpHttpRequest(request: Request): Promise<Response | null> {
  if (!handlesMcpHttpPath(new URL(request.url).pathname)) return null;
  try {
    const config = getMcpConfig(request);
    let handler = liveHandlers.get(config.serverUrl.href);
    if (!handler) liveHandlers.set(config.serverUrl.href, handler = createMcpHttpHandler(config, new DrizzleOAuthStore(), { policy: loadMcpPolicy }));
    return await handler(request);
  } catch {
    console.error("[Sticks & Clay] MCP service unavailable");
    return Response.json({ error: "server_error", error_description: "MCP service is unavailable; check owner configuration and database migrations" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
