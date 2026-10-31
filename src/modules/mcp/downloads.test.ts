import { expect, setSystemTime, test } from "bun:test";
import { decodeJwt } from "jose";
import { createArtifactDownload, verifyArtifactDownload } from "./downloads.server";
import { resolveMcpConfig } from "./auth/config.server";
import type { StoredOAuthClient, StoredOAuthToken } from "./auth/oauth-store.server";

function fixture() {
  const config = resolveMcpConfig({ MCP_PUBLIC_URL: "https://studio.example/api/mcp", MCP_OWNER_PASSWORD: "fixture-password-".repeat(3) });
  const grant = { accessTokenId: "access-1", clientId: "client-1", expiresAt: Math.floor(Date.now() / 1000) + 900 };
  const active: StoredOAuthToken = {
    accessTokenId: grant.accessTokenId, clientId: grant.clientId, scopes: ["sticks-and-clay:read"],
    accessTokenExpiresAt: new Date(grant.expiresAt * 1000), revokedAt: null,
  };
  const client: StoredOAuthClient = { id: grant.clientId, name: "fixture", redirectUris: [], revokedAt: null };
  const store = {
    getActiveAccessToken: async (id: string) => id === active.accessTokenId ? active : null,
    getClient: async (id: string) => id === client.id ? client : null,
  };
  return { config, grant, active, client, store };
}

test("download links expire after five minutes or the source grant, whichever is sooner", async () => {
  const { config, grant, store } = fixture();
  const key = "exports/fixture/collection.zip";
  const now = Math.floor(Date.now() / 1000);
  try {
    setSystemTime(new Date(now * 1000));
    for (const lifetime of [30, 900]) {
      const link = await createArtifactDownload(key, config, { ...grant, expiresAt: now + lifetime });
      const ticket = new URL(link.downloadUrl).searchParams.get("ticket");
      if (!ticket) throw new Error("Expected a download ticket");
      const expiry = now + Math.min(lifetime, 300);
      expect(decodeJwt(ticket).exp).toBe(expiry);
      expect(link.downloadExpiresAt).toBe(new Date(expiry * 1000).toISOString());
      expect(await verifyArtifactDownload(ticket, key, config, store)).toBe(true);
      setSystemTime(new Date(expiry * 1000));
      expect(await verifyArtifactDownload(ticket, key, config, store)).toBe(false);
      setSystemTime(new Date(now * 1000));
    }
    await expect(createArtifactDownload(key, config, { ...grant, expiresAt: now })).rejects.toThrow("expired");
  } finally { setSystemTime(); }
});

test("download tickets are bound to one artifact, deployment, and active read grant", async () => {
  const { config, grant, active, client, store } = fixture();
  const key = "graphics/fixture/image.png";
  const link = await createArtifactDownload(key, config, grant);
  const ticket = new URL(link.downloadUrl).searchParams.get("ticket");
  if (!ticket) throw new Error("Expected a download ticket");
  expect(await verifyArtifactDownload(ticket, key, config, store)).toBe(true);
  expect(await verifyArtifactDownload(ticket, "graphics/fixture/other.png", config, store)).toBe(false);
  expect(await verifyArtifactDownload(ticket, key, { ...config, signingSecret: "rotated".repeat(10) }, store)).toBe(false);
  expect(await verifyArtifactDownload(ticket, key, { ...config, serverUrl: new URL("https://other.example/api/mcp") }, store)).toBe(false);
  expect(await verifyArtifactDownload(ticket, key, { ...config, issuer: new URL("https://other.example/") }, store)).toBe(false);
  expect(await verifyArtifactDownload(ticket, key, config, { ...store, getActiveAccessToken: async () => null })).toBe(false);
  expect(await verifyArtifactDownload(ticket, key, config, { ...store, getClient: async () => null })).toBe(false);
  active.scopes = ["sticks-and-clay:write"];
  expect(await verifyArtifactDownload(ticket, key, config, store)).toBe(false);
  active.scopes = ["sticks-and-clay:read"];
  active.clientId = "other-client";
  expect(await verifyArtifactDownload(ticket, key, config, store)).toBe(false);
  active.clientId = grant.clientId;
  active.revokedAt = new Date();
  expect(await verifyArtifactDownload(ticket, key, config, store)).toBe(false);
  active.revokedAt = null;
  active.accessTokenExpiresAt = new Date(0);
  expect(await verifyArtifactDownload(ticket, key, config, store)).toBe(false);
  active.accessTokenExpiresAt = new Date(grant.expiresAt * 1000);
  client.revokedAt = new Date();
  expect(await verifyArtifactDownload(ticket, key, config, store)).toBe(false);
});
