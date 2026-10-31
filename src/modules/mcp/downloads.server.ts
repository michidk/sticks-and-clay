import { createHmac } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { artifactDownloadUrl, artifactKey } from "./artifacts.server";
import { MCP_READ_SCOPE, type McpConfig } from "./auth/config.server";
import type { OAuthStore } from "./auth/oauth-store.server";

const DOWNLOAD_TTL_SECONDS = 5 * 60;
const DOWNLOAD_TOKEN_TYPE = "artifact-download+jwt";
export const downloadGrant = z.object({
  accessTokenId: z.string().min(1), clientId: z.string().min(1), expiresAt: z.number().int(),
});
const downloadClaims = z.object({
  key: artifactKey, aid: z.string().min(1), cid: z.string().min(1), exp: z.number().int(),
});

function signingKey(config: McpConfig) {
  return createHmac("sha256", config.signingSecret)
    .update("sticks-and-clay:mcp-artifact-download:v1").digest();
}

export async function createArtifactDownload(key: string, config: McpConfig, grant: z.output<typeof downloadGrant>) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Math.min(now + DOWNLOAD_TTL_SECONDS, grant.expiresAt);
  if (expiresAt <= now) throw new Error("Download grant expired");
  const ticket = await new SignJWT({ key, aid: grant.accessTokenId, cid: grant.clientId })
    .setProtectedHeader({ alg: "HS256", typ: DOWNLOAD_TOKEN_TYPE })
    .setIssuer(config.issuer.toString()).setAudience(config.serverUrl.toString())
    .setIssuedAt(now).setExpirationTime(expiresAt).sign(signingKey(config));
  const url = new URL(artifactDownloadUrl(key, config.serverUrl));
  url.searchParams.set("ticket", ticket);
  return { downloadUrl: url.toString(), downloadExpiresAt: new Date(expiresAt * 1000).toISOString() };
}

export async function verifyArtifactDownload(ticket: string, key: string, config: McpConfig,
  store: Pick<OAuthStore, "getActiveAccessToken" | "getClient">,
) {
  try {
    const { payload } = await jwtVerify(ticket, signingKey(config), {
      algorithms: ["HS256"], typ: DOWNLOAD_TOKEN_TYPE,
      issuer: config.issuer.toString(), audience: config.serverUrl.toString(),
    });
    const claims = downloadClaims.parse(payload);
    if (claims.key !== key) return false;
    const active = await store.getActiveAccessToken(claims.aid);
    if (!active || active.clientId !== claims.cid || active.revokedAt
      || active.accessTokenExpiresAt.getTime() <= Date.now() || !active.scopes.includes(MCP_READ_SCOPE)) return false;
    const client = await store.getClient(claims.cid);
    return !!client && !client.revokedAt;
  } catch { return false; }
}
