import { expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { z } from "zod";
import { eq, gte } from "drizzle-orm";
import { db } from "../../db/client";
import { projects, revisions, mcpAuditEvents } from "../../db/schema";
import { resolveMcpConfig } from "./config.server";
import { createMcpHttpHandler } from "./http.server";

const integration = process.env.TEST_DATABASE === "1" ? test : test.skip;
const config = resolveMcpConfig({ MCP_PUBLIC_URL: "https://studio.example/api/mcp", MCP_SECRET: "test-signing-secret-".repeat(3) });

async function session(readFile = async (_key: string) => new Blob(["fixture"]), disabledTools: string[] = []) {
  const startedAt = new Date();
  const handler = createMcpHttpHandler(config, { readFile, policy: async () => ({ enabled: true, disabledTools }) });
  const send = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers({ Host: config.serverUrl.host });
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    const response = await handler(new Request(new URL(path, config.serverUrl), { ...init, headers }));
    if (!response) throw new Error("Request was not handled");
    return response;
  };
  const client = new Client({ name: "http-test", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  await client.connect(new StreamableHTTPClientTransport(config.serverUrl, { fetch: async (input, init) => {
    const req = new Request(input, init);
    req.headers.set("Host", config.serverUrl.host);
    const response = await handler(req);
    if (!response) throw new Error("MCP was not handled");
    return response;
  } }));
  return { client, send, startedAt, close: async () => {
    await client.close();
    await db.delete(mcpAuditEvents).where(gte(mcpAuditEvents.createdAt, startedAt));
  } };
}

integration("stateless 2026-07-28 HTTP, host/origin checks, download boundaries and no OAuth surface", async () => {
  const connected = await session(undefined, ["get_settings"]);
  try {
    expect((await connected.send("/api/mcp", { headers: { Host: "evil.example" } })).status).toBe(403);
    expect((await connected.send("/api/mcp", { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await connected.send("/api/mcp", { headers: { Origin: config.serverUrl.origin } })).status).not.toBe(403);
    for (const path of ["/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-authorization-server", "/oauth/token", "/oauth/register"])
      expect(await handlerStatus(connected, path)).toBe(404);
    expect(connected.client.getServerVersion()?.name).toBe("sticks-and-clay");
    const tools = await connected.client.listTools();
    expect(tools.tools.some((tool) => tool.name === "generate_asset")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "get_settings")).toBe(false);
    expect(tools.tools.some((tool) => tool.name === "revoke_mcp_client")).toBe(false);
    expect((await connected.send("/api/mcp/files/assignments/fixture/model.glb")).status).toBe(401);
    expect((await connected.send("/api/mcp/files/references/.private")).status).toBe(400);
    const oversized = await connected.send("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: " ".repeat(300 * 1024 * 1024) });
    expect(oversized.status).toBe(413);
  } finally { await connected.close(); }
});

async function handlerStatus(connected: { send: (path: string, init?: RequestInit) => Promise<Response> }, path: string) {
  try { return (await connected.send(path)).status; } catch { return 404; }
}

integration("MCP returns a short-lived file URL that downloads exact bytes with a signed ticket and no credentials", async () => {
  const bytes = Buffer.alloc(17 * 1024 * 1024 + 17);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const key = "graphics/fixture/preview #1.png";
  let reads = 0;
  const connected = await session(async (requested) => {
    reads++;
    expect(requested).toBe(key);
    return new Blob([bytes]);
  });
  const output = z.object({ data: z.object({ downloadUrl: z.url(), downloadExpiresAt: z.iso.datetime(), sizeBytes: z.number() }) });
  try {
    const artifact = await connected.client.callTool({ name: "read_artifact", arguments: { key } });
    expect(artifact.isError).not.toBe(true);
    expect(JSON.stringify(artifact).length).toBeLessThan(5000);
    const { data } = output.parse(artifact.structuredContent);
    expect(data.sizeBytes).toBe(bytes.length);
    const remaining = Date.parse(data.downloadExpiresAt) - Date.now();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(5 * 60 * 1000);
    const link = new URL(data.downloadUrl);
    const download = await connected.send(link.pathname + link.search);
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(download.headers.get("Content-Type")).toBe("image/png");
    expect(download.headers.get("Cache-Control")).toBe("private, no-store");
    expect(download.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
    expect((await connected.send(link.pathname)).status).toBe(401);
    const otherFile = new URL(link);
    otherFile.pathname = otherFile.pathname.replace("preview", "other");
    expect((await connected.send(otherFile.pathname + otherFile.search)).status).toBe(401);
    const altered = new URL(link);
    altered.searchParams.set("ticket", `${altered.searchParams.get("ticket")}invalid`);
    expect((await connected.send(altered.pathname + altered.search)).status).toBe(401);
    expect((await connected.send(`/api/mcp${link.search}`)).status).toBe(405);
    expect((await connected.send(link.pathname + link.search, { method: "POST", headers: { Authorization: "" } })).status).toBe(405);
    expect(reads).toBe(2);
  } finally { await connected.close(); }
});

integration("MCP mutations retain design approval, optimistic conflicts, immutable history and failed-call auditing", async () => {
  const connected = await session();
  const id = crypto.randomUUID();
  const design = "# Integration design\nWarm clay props with consistent meter scale. ".repeat(3);
  await db.insert(projects).values({ id, name: "MCP fixture", description: "", status: "review", design, designVersion: 1 });
  try {
    const unapproved = await connected.client.callTool({ name: "generate_asset", arguments: { projectId: id, prompt: "A small lamp", judgeIterations: 0 } });
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
    const audits = await db.select().from(mcpAuditEvents).where(gte(mcpAuditEvents.createdAt, connected.startedAt));
    expect(audits.map(({ toolName, outcome }) => ({ toolName, outcome }))).toEqual([
      { toolName: "generate_asset", outcome: "failure" },
      { toolName: "save_design", outcome: "success" },
      { toolName: "save_design", outcome: "failure" },
    ]);
  } finally {
    await db.delete(revisions).where(eq(revisions.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
    await connected.close();
  }
});

test("a paused server rejects MCP requests", async () => {
  const handler = createMcpHttpHandler(config, { policy: async () => ({ enabled: false, disabledTools: [] }) });
  const response = await handler(new Request(config.serverUrl, { method: "POST", headers: { Host: config.serverUrl.host } }));
  expect(response?.status).toBe(503);
  expect(await response?.json()).toMatchObject({ error: "mcp_disabled" });
});
