import { expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { projects, revisions, oauthClients, mcpAuditEvents } from "../../db/schema";
import { getOAuthSigningKey } from "./auth/auth.server";
import { resolveMcpConfig } from "./auth/config.server";
import { DrizzleOAuthStore } from "./auth/oauth-store.server";
import { createMcpHttpHandler } from "./http.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const config = resolveMcpConfig({ MCP_PUBLIC_URL: "https://studio.example/api/mcp", MCP_OWNER_PASSWORD: "test-owner-password-".repeat(3) });
const read = "sticks-and-clay:read";
const write = "sticks-and-clay:write";

async function session(scopes = [read]) {
  const store = new DrizzleOAuthStore();
  const clientId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  await store.createClient({ id: clientId, name: "HTTP integration fixture", redirectUris: ["http://127.0.0.1/callback"] });
  await store.saveAccessToken({ accessTokenId: tokenId, clientId, scopes, accessTokenExpiresAt: new Date(Date.now() + 900000), revokedAt: null });
  const token = await new SignJWT({ cid: clientId, scope: scopes.join(" ") }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(config.issuer.toString()).setAudience(config.serverUrl.toString()).setJti(tokenId).setIssuedAt().setExpirationTime("15m")
    .sign(getOAuthSigningKey(config.signingSecret));
  const handler = createMcpHttpHandler(config, store, { readFile: async () => new Blob(["fixture"]) });
  const send = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers({
      Host: config.serverUrl.host, Authorization: `Bearer ${token}`,
    });
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    if (headers.get("Authorization") === "") headers.delete("Authorization");
    const response = await handler(new Request(new URL(path, config.issuer), { ...init, headers }));
    if (!response) throw new Error("Request was not handled");
    return response;
  };
  const client = new Client({ name: "http-test", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  await client.connect(new StreamableHTTPClientTransport(config.serverUrl, { fetch: async (input, init) => {
    const req = new Request(input, init);
    req.headers.set("Host", config.serverUrl.host);
    req.headers.set("Authorization", `Bearer ${token}`);
    const response = await handler(req);
    if (!response) throw new Error("MCP was not handled");
    return response;
  } }));
  return { store, client, clientId, send, close: async () => {
    await client.close();
    await db.delete(mcpAuditEvents).where(eq(mcpAuditEvents.clientId, clientId));
    await db.delete(oauthClients).where(eq(oauthClients.id, clientId));
  } };
}

integration("authenticated HTTP challenges, host/origin checks, download boundaries and immediate revocation", async () => {
  const connected = await session();
  try {
    const challenge = await connected.send("/api/mcp", { method: "POST", headers: { Authorization: "" }, body: "not JSON" });
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("WWW-Authenticate")).toContain("oauth-protected-resource/api/mcp");
    expect(challenge.headers.get("WWW-Authenticate")).toContain(write);
    expect((await connected.send("/api/mcp", { headers: { Host: "evil.example" } })).status).toBe(403);
    expect((await connected.send("/api/mcp", { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    const preflight = await connected.send("/api/mcp", { method: "OPTIONS", headers: { Origin: config.issuer.origin } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(config.issuer.origin);
    const metadata = await connected.send("/.well-known/oauth-protected-resource/api/mcp", { headers: { Authorization: "" } });
    expect((await metadata.json()).resource).toBe(config.serverUrl.toString());
    const download = await connected.send("/api/mcp/files/assignments/fixture/model.glb");
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Type")).toBe("model/gltf-binary");
    expect(download.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await download.text()).toBe("fixture");
    expect((await connected.send("/api/mcp/files/references/.private")).status).toBe(400);
    expect((await connected.send("/api/mcp/files/runtime-settings.json")).status).toBe(400);
    expect((await connected.send("/api/mcp/files/references/a.png", { headers: { Authorization: "" } })).status).toBe(401);
    const tools = await connected.client.listTools();
    expect(tools.tools.some((tool) => tool.name === "generate_assets")).toBe(false);
    expect(tools.tools.some((tool) => tool.name === "get_settings")).toBe(false);
    await expect(connected.client.callTool({ name: "generate_assets", arguments: { projectId: crypto.randomUUID(), count: 1, judgeIterations: 0 } })).rejects.toThrow();
    const oversized = await connected.send("/api/mcp", { method: "POST", body: " ".repeat(4 * 1024 * 1024 + 1) });
    expect(oversized.status).toBe(413);
    await connected.store.revokeClient(connected.clientId);
    expect((await connected.send("/api/mcp")).status).toBe(401);
    expect((await connected.send("/api/mcp/files/references/a.png")).status).toBe(401);
  } finally { await connected.close(); }
});

integration("MCP mutations retain design approval, optimistic conflicts, immutable history and failed-call auditing", async () => {
  const connected = await session([read, write]);
  const id = crypto.randomUUID();
  const design = "# Integration design\nWarm clay props with consistent meter scale. ".repeat(3);
  await db.insert(projects).values({ id, name: "MCP fixture", description: "", status: "review", design, designVersion: 1 });
  try {
    const unapproved = await connected.client.callTool({ name: "generate_assets", arguments: { projectId: id, count: 1, judgeIterations: 0 } });
    expect(unapproved.isError).toBe(true);
    expect(unapproved.structuredContent).toMatchObject({ data: { error: expect.any(String) } });
    const saved = await connected.client.callTool({ name: "save_design", arguments: { projectId: id, design, version: 1, approve: true } });
    expect(saved.isError).not.toBe(true);
    const stale = await connected.client.callTool({ name: "save_design", arguments: { projectId: id, design: design + "Stale edit", version: 1, approve: false } });
    expect(stale.isError).toBe(true);
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    expect(project.status).toBe("ready");
    expect(project.designVersion).toBe(2);
    expect(project.design).toBe(design);
    const history = await db.select().from(revisions).where(eq(revisions.projectId, id));
    expect(history).toHaveLength(1);
    const audits = await db.select().from(mcpAuditEvents).where(eq(mcpAuditEvents.clientId, connected.clientId));
    expect(audits.map(({ toolName, outcome }) => ({ toolName, outcome }))).toEqual([
      { toolName: "generate_assets", outcome: "failure" },
      { toolName: "save_design", outcome: "success" },
      { toolName: "save_design", outcome: "failure" },
    ]);
  } finally {
    await db.delete(revisions).where(eq(revisions.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
    await connected.close();
  }
});

test("a paused server rejects MCP and OAuth requests before authentication", async () => {
  const handler = createMcpHttpHandler(config, new DrizzleOAuthStore(), { policy: async () => ({ enabled: false, disabledTools: [] }) });
  for (const path of ["/api/mcp", "/oauth/token"]) {
    const response = await handler(new Request(new URL(path, config.issuer), { method: "POST", headers: { Host: config.serverUrl.host } }));
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ error: "mcp_disabled" });
  }
});
