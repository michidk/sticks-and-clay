import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { jwtVerify } from "jose";
import { mcpScopeSchema } from "../catalog";
import type { McpConfig } from "./config.server";
import type { OAuthStore } from "./oauth-store.server";

export function getOAuthSigningKey(secret: string) {
  return createHmac("sha256", secret)
    .update("sticks-and-clay:mcp-oauth:access-token:v1")
    .digest();
}

export function hasValidOwnerSession(request: Request) {
  // Hodor strips client-supplied copies; only enable this behind its private upstream.
  const method = request.headers.get("x-hodor-auth");
  return method === "password" || method === "bypass";
}

export function validOwnerPassword(value: unknown, config: McpConfig) {
  if (config.ownerAuth.kind !== "password") return false;
  const supplied = createHash("sha256")
    .update(typeof value === "string" ? value : "")
    .digest();
  const expected = createHash("sha256").update(config.ownerAuth.password).digest();
  return timingSafeEqual(supplied, expected);
}

export function createLocalTokenVerifier(
  config: McpConfig,
  store: OAuthStore,
): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      try {
        const { payload } = await jwtVerify(
          token,
          getOAuthSigningKey(config.signingSecret),
          {
            algorithms: ["HS256"],
            issuer: config.issuer.toString(),
            audience: config.serverUrl.toString(),
            typ: "JWT",
          },
        );
        if (
          typeof payload.jti !== "string" ||
          typeof payload.cid !== "string" ||
          typeof payload.exp !== "number" ||
          typeof payload.scope !== "string"
        )
          throw new Error("Missing access-token claims");
        const scopes = payload.scope
          .split(" ")
          .filter(Boolean)
          .map((scope) => mcpScopeSchema.parse(scope));
        const active = await store.getActiveAccessToken(payload.jti);
        const client = await store.getClient(payload.cid);
        if (
          !active ||
          active.clientId !== payload.cid ||
          !client ||
          client.revokedAt ||
          scopes.some((scope) => !active.scopes.includes(scope))
        )
          throw new Error("Token revoked");
        return {
          token,
          clientId: payload.cid,
          scopes,
          expiresAt: payload.exp,
          resource: config.serverUrl,
        };
      } catch {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          "The access token is invalid, expired, or revoked",
        );
      }
    },
  };
}
