import { randomUUID } from "node:crypto";
import { OAuthException } from "@jmondi/oauth2-server";
import {
  handleVanillaError,
  requestFromVanilla,
  responseToVanilla,
} from "@jmondi/oauth2-server/vanilla";
import { hostHeaderValidationResponse } from "@modelcontextprotocol/server";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { MCP_SCOPE_VALUES, MCP_SCOPE_DETAILS, type McpScope } from "../catalog";
import { getOAuthSigningKey, hasValidOwnerSession, validOwnerPassword } from "./auth.server";
import { MCP_READ_SCOPE, type McpConfig } from "./config.server";
import { createOAuthServer } from "./oauth.server";
import { hashOAuthSecret, type OAuthStore } from "./oauth-store.server";

const paths = new Set([
  "/.well-known/oauth-authorization-server",
  "/.well-known/oauth-protected-resource/api/mcp",
  "/oauth/register",
  "/oauth/authorize",
  "/oauth/token",
  "/oauth/revoke",
]);
const scopeSchema = z.enum(MCP_SCOPE_VALUES);
const cookieName = "studio_mcp_consent";
const registrationSchema = z.object({
  client_name: z.string().trim().min(1).max(200).default("MCP client"),
  redirect_uris: z.array(z.string().max(2048)).min(1).max(10),
  token_endpoint_auth_method: z.literal("none").default("none"),
  grant_types: z
    .array(z.enum(["authorization_code", "refresh_token"]))
    .min(1)
    .default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.literal("code")).min(1).default(["code"]),
  scope: z.string().trim().max(500).optional(),
});

export function handlesOAuthPath(pathname: string) {
  return paths.has(pathname);
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function safeRedirectUri(value: string) {
  try {
    const url = new URL(value);
    return (
      !url.hash &&
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

function scopes(value: string) {
  return [...new Set(value.split(/\s+/).filter(Boolean))].map((scope) => {
    const parsed = scopeSchema.safeParse(scope);
    if (!parsed.success) throw OAuthException.invalidScope(scope);
    return parsed.data;
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function scopeInputName(scope: McpScope) {
  return `scope_${scope.replaceAll(":", "_").replaceAll("-", "_")}`;
}

function consentCookie(token: string, config: McpConfig, clear = false) {
  return `${cookieName}=${token}; Path=/oauth/authorize; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 600}${config.serverUrl.protocol === "https:" ? "; Secure" : ""}`;
}

function withConsentCookie(
  response: Response,
  token: string,
  config: McpConfig,
  clear = false,
) {
  const headers = new Headers(response.headers);
  headers.set("Set-Cookie", consentCookie(token, config, clear));
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

function consentPage(
  clientName: string,
  url: URL,
  requested: McpScope[],
  redirectUri: string,
  csrf: string,
  ownerAuth: McpConfig["ownerAuth"],
) {
  const passwordControl = ownerAuth.kind === "password"
    ? '<label for="owner-password">Workshop owner password</label><input id="owner-password" name="owner_password" type="password" autocomplete="current-password" required maxlength="1024">'
    : "";
  const controls = requested
    .map((scope) => {
      const details = MCP_SCOPE_DETAILS[scope];
      const required = scope === MCP_READ_SCOPE;
      return `<label class="scope"><input type="checkbox" name="${scopeInputName(scope)}"${required ? " checked disabled" : ""}><span><strong>${escapeHtml(details.label)}</strong><small>${escapeHtml(details.description)}</small></span></label>${required ? `<input type="hidden" name="${scopeInputName(scope)}" value="on">` : ""}`;
    })
    .join("");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Sticks &amp; Clay</title><style>body{font:16px system-ui;max-width:42rem;margin:8vh auto;padding:1.5rem;color:#213b2d;background:#f8f5ed}main{border:1px solid #dedfd2;border-radius:12px;padding:2rem;background:#fffdf7}h1{margin-top:0}p{line-height:1.5}.scope{display:flex;gap:.75rem;padding:1rem 0;border-top:1px solid #dedfd2}.scope span{display:grid;gap:.25rem}small{color:#586555;line-height:1.4}input[type=password]{box-sizing:border-box;display:block;width:100%;padding:.7rem;margin:.5rem 0 1rem;border:1px solid #899681;border-radius:6px;font:inherit}button{font:inherit;padding:.7rem 1rem;margin:.75rem .5rem 0 0;border-radius:6px;border:1px solid #38553e;background:#fffdf7}.approve{background:#294a34;color:#fffdf7}</style></head><body><main><h1>Authorize Sticks &amp; Clay access?</h1><p><strong>${escapeHtml(clientName)}</strong> wants access to this workshop. Select the permissions you want to grant. Generating assets can spend the configured AI budget.</p><form method="post" action="${escapeHtml(url.pathname + url.search)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${controls}${passwordControl}<button class="approve" name="decision" value="approve">Authorize</button><button name="decision" value="deny">Deny</button></form></main></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Frame-Options": "DENY",
        // Preserve Origin on consent POSTs without sending referrers to callbacks.
        "Referrer-Policy": "same-origin",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(redirectUri).origin}; frame-ancestors 'none'; base-uri 'none'`,
      },
    },
  );
}

async function audit(
  store: OAuthStore,
  event: Parameters<OAuthStore["audit"]>[0],
) {
  try {
    await store.audit(event);
  } catch {
    console.error("[Sticks & Clay] MCP audit persistence failed");
  }
}

function oauthError(error: unknown) {
  const response = responseToVanilla(handleVanillaError(error));
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, { status: response.status, headers });
}

async function oauthRequest(
  request: Request,
  config: McpConfig,
  location: "query" | "body",
) {
  const converted = await requestFromVanilla(request);
  if (converted[location].resource !== config.serverUrl.toString())
    throw OAuthException.invalidParameter(
      "resource",
      "The resource must identify this MCP server",
    );
  converted[location].audience = config.serverUrl.toString();
  return converted;
}

async function boundedRequest(request: Request) {
  if (!request.body) return request;
  const reader = request.body.getReader();
  const bytes = new Uint8Array(32768);
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (length + chunk.value.byteLength > bytes.length) {
        await reader.cancel();
        return null;
      }
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    return new Request(request, { body: bytes.slice(0, length) });
  } finally {
    reader.releaseLock();
  }
}

async function validConsent(
  request: Request,
  url: URL,
  form: FormData,
  config: McpConfig,
  store: OAuthStore,
) {
  const csrf = form.get("csrf");
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (typeof csrf !== "string" || !cookie || csrf !== cookie) return false;
  try {
    const { payload } = await jwtVerify(
      csrf,
      getOAuthSigningKey(config.signingSecret),
      {
        algorithms: ["HS256"],
        typ: "mcp-consent+jwt",
        issuer: config.issuer.toString(),
        audience: "owner-consent",
      },
    );
    if (payload.request !== hashOAuthSecret(url.pathname + url.search))
      return false;
    return await store.consumeConsentTransaction(csrf);
  } catch {
    return false;
  }
}

export function createOAuthHttpHandler(config: McpConfig, store: OAuthStore) {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!handlesOAuthPath(url.pathname)) return null;
    const rejectedHost = hostHeaderValidationResponse(
      request,
      config.allowedHostnames,
    );
    if (rejectedHost) return rejectedHost;
    if (request.method === "POST") {
      const bounded = await boundedRequest(request);
      if (!bounded)
        return json(
          {
            error: "invalid_request",
            error_description: "OAuth request body exceeds 32 KiB",
          },
          413,
        );
      request = bounded;
    }
    const oauth = createOAuthServer(config, store);
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Cache-Control": "no-store",
        },
      });
    if (
      request.method === "GET" &&
      url.pathname === "/.well-known/oauth-authorization-server"
    )
      return json({
        issuer: config.issuer.toString(),
        authorization_endpoint: new URL(
          "/oauth/authorize",
          config.issuer,
        ).toString(),
        token_endpoint: new URL("/oauth/token", config.issuer).toString(),
        registration_endpoint: new URL(
          "/oauth/register",
          config.issuer,
        ).toString(),
        revocation_endpoint: new URL("/oauth/revoke", config.issuer).toString(),
        scopes_supported: MCP_SCOPE_VALUES,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        revocation_endpoint_auth_methods_supported: ["none"],
      });
    if (
      request.method === "GET" &&
      url.pathname === "/.well-known/oauth-protected-resource/api/mcp"
    )
      return json({
        resource: config.serverUrl.toString(),
        authorization_servers: [config.issuer.toString()],
        scopes_supported: MCP_SCOPE_VALUES,
        bearer_methods_supported: ["header"],
        resource_name: "Sticks & Clay asset workshop",
      });
    if (request.method === "POST" && url.pathname === "/oauth/register") {
      try {
        const body = await request.text();
        if (Buffer.byteLength(body) > 32768)
          return json({ error: "invalid_client_metadata" }, 413);
        const registration = registrationSchema.parse(JSON.parse(body));
        const requested = scopes(
          registration.scope ?? MCP_SCOPE_VALUES.join(" "),
        );
        if (
          !registration.grant_types.includes("authorization_code") ||
          !registration.redirect_uris.every(safeRedirectUri)
        )
          return json(
            {
              error: "invalid_client_metadata",
              error_description:
                "Registration requires authorization_code and HTTPS or loopback redirect URIs",
            },
            400,
          );
        const clientId = randomUUID();
        await store.createClient({
          id: clientId,
          name: registration.client_name,
          redirectUris: registration.redirect_uris,
        });
        await audit(store, {
          event: "client_registered",
          outcome: "success",
          clientId,
        });
        return json(
          {
            client_id: clientId,
            client_id_issued_at: Math.floor(Date.now() / 1000),
            ...registration,
            scope: requested.join(" "),
          },
          201,
        );
      } catch {
        return json({ error: "invalid_client_metadata" }, 400);
      }
    }
    if (
      url.pathname === "/oauth/authorize" &&
      ["GET", "POST"].includes(request.method)
    ) {
      if (config.ownerAuth.kind === "hodor" && !hasValidOwnerSession(request))
        return json({ error: "access_denied", error_description: "Workshop login required" }, 401);
      try {
        const authorizationUrl = new URL(url);
        if (!authorizationUrl.searchParams.has("scope"))
          authorizationUrl.searchParams.set(
            "scope",
            MCP_SCOPE_VALUES.join(" "),
          );
        const requested = scopes(
          authorizationUrl.searchParams.get("scope") ?? "",
        );
        const converted = await oauthRequest(
          new Request(authorizationUrl),
          config,
          "query",
        );
        const authorization =
          await oauth.server.validateAuthorizationRequest(converted);
        if (!authorization.redirectUri)
          throw OAuthException.invalidParameter("redirect_uri");
        if (request.method === "GET") {
          const expiry = new Date(Date.now() + 600_000);
          const token = await new SignJWT({
            request: hashOAuthSecret(url.pathname + url.search),
          })
            .setProtectedHeader({ alg: "HS256", typ: "mcp-consent+jwt" })
            .setIssuer(config.issuer.toString())
            .setAudience("owner-consent")
            .setJti(randomUUID())
            .setIssuedAt()
            .setExpirationTime(Math.floor(expiry.getTime() / 1000))
            .sign(getOAuthSigningKey(config.signingSecret));
          await store.saveConsentTransaction(token, expiry);
          return withConsentCookie(
            consentPage(
              authorization.client.name,
              url,
              [...new Set<McpScope>([MCP_READ_SCOPE, ...requested])],
              authorization.redirectUri,
              token,
              config.ownerAuth,
            ),
            token,
            config,
          );
        }
        if (request.headers.get("origin") !== config.issuer.origin)
          return json(
            {
              error: "access_denied",
              error_description: "Invalid consent origin",
            },
            403,
          );
        const form = await request.formData();
        if (config.ownerAuth.kind === "password" && !validOwnerPassword(form.get("owner_password"), config)) {
          await audit(store, {
            event: "authorization",
            outcome: "failure",
            clientId: authorization.client.id,
          });
          return json(
            {
              error: "access_denied",
              error_description: "Owner authentication required",
            },
            401,
          );
        }
        if (!(await validConsent(request, url, form, config, store)))
          return json(
            {
              error: "access_denied",
              error_description:
                "Consent expired or invalid; open the authorization link again",
            },
            403,
          );
        if (form.get("decision") !== "approve") {
          const denied = new URL(authorization.redirectUri);
          denied.searchParams.set("error", "access_denied");
          if (authorization.state)
            denied.searchParams.set("state", authorization.state);
          await audit(store, {
            event: "authorization",
            outcome: "denied",
            clientId: authorization.client.id,
          });
          return withConsentCookie(
            Response.redirect(denied, 302),
            "",
            config,
            true,
          );
        }
        authorization.scopes = [
          ...new Set<McpScope>([
            MCP_READ_SCOPE,
            ...requested.filter(
              (scope) => form.get(scopeInputName(scope)) === "on",
            ),
          ]),
        ].map((name) => ({ name }));
        authorization.user = oauth.owner;
        authorization.isAuthorizationApproved = true;
        const response = responseToVanilla(
          await oauth.server.completeAuthorizationRequest(authorization),
        );
        await audit(store, {
          event: "authorization",
          outcome: "success",
          clientId: authorization.client.id,
        });
        return withConsentCookie(response, "", config, true);
      } catch (error) {
        return oauthError(error);
      }
    }
    if (request.method === "POST" && url.pathname === "/oauth/token") {
      try {
        const converted = await oauthRequest(request, config, "body");
        const response = responseToVanilla(
          await oauth.server.respondToAccessTokenRequest(converted),
        );
        await audit(store, {
          event: "token_issued",
          outcome: "success",
          clientId: String(converted.body.client_id ?? ""),
        });
        return new Response(response.body, {
          status: response.status,
          headers: {
            ...Object.fromEntries(response.headers),
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (error) {
        await audit(store, { event: "token_issued", outcome: "failure" });
        return oauthError(error);
      }
    }
    if (request.method === "POST" && url.pathname === "/oauth/revoke") {
      try {
        const converted = await requestFromVanilla(request);
        const response = responseToVanilla(
          await oauth.server.revoke(converted),
        );
        await audit(store, {
          event: "token_revoked",
          outcome: "success",
          clientId: String(converted.body.client_id ?? ""),
        });
        return new Response(response.body, {
          status: response.status,
          headers: {
            ...Object.fromEntries(response.headers),
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (error) {
        return oauthError(error);
      }
    }
    return json(
      { error: "invalid_request", error_description: "Method not allowed" },
      405,
    );
  };
}
