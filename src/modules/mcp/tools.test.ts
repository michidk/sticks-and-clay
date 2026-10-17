import { expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { runtimeSettingsDefaults } from "../../lib/runtime-settings";
import { createStudioMcpServer, studioToolCatalog } from "./tools.server";

const id = "12345678-1234-4234-8234-123456789012";
const sourceRunId = "12345678-1234-4234-8234-123456789013";
const publicUrl = new URL("https://studio.example");
const read = "sticks-and-clay:read";
const write = "sticks-and-clay:write";
const admin = "sticks-and-clay:admin";
type Options = Parameters<typeof createStudioMcpServer>[0];

async function session(options: Partial<Options> = {}) {
  const handler = createMcpHandler(() => createStudioMcpServer({
    scopes: [read, write, admin],
    publicUrl,
    api: async () => Response.json({ id }),
    ...options,
  }), { keepAliveMs: 0 });
  const client = new Client({ name: "studio-test", version: "1" }, {
    versionNegotiation: { mode: { pin: "2026-07-28" } },
  });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", publicUrl), {
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    }));
  } catch (error) {
    await client.close();
    await handler.close();
    throw error;
  }
  return { client, close: async () => { await client.close(); await handler.close(); } };
}

const glb = Buffer.alloc(20);
glb.write("glTF");
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(20, 8);

const actions: {
  name: string; scope: string; method: string; path: string; args: Record<string, unknown>;
}[] = [
  { name: "list_projects", scope: read, method: "GET", path: "projects", args: {} },
  { name: "get_project", scope: read, method: "GET", path: `projects/${id}`, args: { projectId: id } },
  { name: "draft_project_name", scope: write, method: "POST", path: "projects/name", args: { description: "Forest tools" } },
  { name: "draft_project_brief", scope: write, method: "POST", path: "projects/brief", args: { name: "Forest tools" } },
  { name: "create_project", scope: write, method: "POST", path: "projects", args: { name: "Forest tools" } },
  { name: "draft_asset_brief", scope: write, method: "POST", path: `projects/${id}/model-brief`, args: { projectId: id, count: 1 } },
  { name: "save_design", scope: write, method: "PUT", path: `projects/${id}/design`, args: { projectId: id, design: "A".repeat(100), version: 0, approve: true } },
  { name: "update_workshop", scope: write, method: "PUT", path: `projects/${id}/workshop`, args: { projectId: id } },
  { name: "generate_assets", scope: write, method: "POST", path: `projects/${id}/generate`, args: { projectId: id, count: 1, judgeIterations: 0 } },
  { name: "save_idea", scope: write, method: "POST", path: `projects/${id}/ideas`, args: { projectId: id, count: 1, judgeIterations: 0 } },
  { name: "update_idea", scope: write, method: "PUT", path: `projects/${id}/ideas/${sourceRunId}`, args: { projectId: id, ideaId: sourceRunId, count: 2, judgeIterations: 0 } },
  { name: "discard_idea", scope: write, method: "DELETE", path: `projects/${id}/ideas/${sourceRunId}`, args: { projectId: id, ideaId: sourceRunId } },
  { name: "start_idea", scope: write, method: "POST", path: `projects/${id}/ideas/${sourceRunId}/generate`, args: { projectId: id, ideaId: sourceRunId } },
  { name: "retry_project_design", scope: write, method: "POST", path: `projects/${id}/retry-design`, args: { projectId: id } },
  { name: "photograph_project", scope: write, method: "POST", path: `projects/${id}/photograph`, args: { projectId: id } },
  { name: "import_asset", scope: write, method: "POST", path: `projects/${id}/import`, args: { projectId: id, name: "Axe", prompt: "Polish this axe", file: { filename: "axe.glb", base64: glb.toString("base64") } } },
  { name: "list_materials", scope: read, method: "GET", path: `projects/${id}/materials`, args: { projectId: id } },
  { name: "generate_material", scope: write, method: "POST", path: `projects/${id}/materials`, args: { projectId: id, parameters: {} } },
  { name: "branch_asset", scope: write, method: "POST", path: `models/${id}/branch`, args: { modelId: id, kind: "iterate", sourceRunId, prompt: "Fix the handle", judgeIterations: 0 } },
  { name: "update_design_from_asset", scope: write, method: "POST", path: `models/${id}/design-update`, args: { modelId: id, sourceRunId, view: 0 } },
  { name: "approve_visual_target", scope: write, method: "POST", path: `models/${id}/visual-target`, args: { modelId: id, target: "models/target.png" } },
  { name: "revise_visual_target", scope: write, method: "POST", path: `models/${id}/visual-target`, args: { modelId: id, target: "models/target.png", prompt: "Make it taller" } },
  { name: "retry_asset", scope: write, method: "POST", path: `models/${id}/retry`, args: { modelId: id } },
  { name: "list_animation_clips", scope: read, method: "GET", path: `models/${id}/sprite-clips?sourceRunId=${sourceRunId}`, args: { modelId: id, sourceRunId } },
  { name: "render_asset", scope: write, method: "POST", path: `models/${id}/presentation`, args: { modelId: id, sourceRunId } },
  { name: "list_asset_exports", scope: read, method: "GET", path: `models/${id}/workshop-jobs`, args: { modelId: id } },
  { name: "get_export_job", scope: read, method: "GET", path: `workshop-jobs/${id}`, args: { jobId: id } },
  { name: "assign_material", scope: write, method: "POST", path: `models/${id}/material-assignment`, args: { modelId: id, materialVersionId: sourceRunId, slot: "Wood", repeat: 2 } },
  { name: "get_queue", scope: read, method: "GET", path: "queue", args: {} },
  { name: "cancel_job", scope: write, method: "POST", path: `queue/${id}/cancel`, args: { jobId: id } },
  { name: "cancel_pending_jobs", scope: write, method: "POST", path: "queue/cancel-pending", args: {} },
  { name: "resume_export_job", scope: write, method: "POST", path: `queue/${id}/resume`, args: { jobId: id } },
  { name: "resume_batch", scope: write, method: "POST", path: `batches/${id}/resume`, args: { batchId: id } },
  { name: "get_run_events", scope: read, method: "GET", path: `runs/${id}`, args: { runId: id } },
  { name: "get_agents", scope: admin, method: "GET", path: "agents", args: {} },
  { name: "update_agent", scope: admin, method: "PATCH", path: "agents", args: { id: "builder", engine: "eve", model: "gpt-6", effort: "high" } },
  { name: "get_settings", scope: admin, method: "GET", path: "settings", args: {} },
  { name: "update_settings", scope: admin, method: "PATCH", path: "settings", args: { queue: { paused: true } } },
  { name: "replace_settings", scope: admin, method: "PUT", path: "settings", args: runtimeSettingsDefaults({}) },
  { name: "get_diagnostics", scope: admin, method: "GET", path: "diagnostics", args: {} },
];

test("modern SDK clients discover every human action with the correct HTTP method", async () => {
  const requests: { method: string; path: string }[] = [];
  const revoked: string[] = [];
  const connected = await session({
    api: async (request) => {
      const url = new URL(request.url);
      const path = url.pathname.slice(5) + url.search;
      requests.push({ method: request.method, path });
      if (request.method === "GET") {
        if (path === "projects") return Response.json({ projects: [] });
        if (path === `projects/${id}`) return Response.json({ project: { id }, models: [] });
        if (path === "queue") return Response.json({ control: {}, jobs: [] });
        if (/\/(materials|workshop-jobs)$/.test(path) || path.startsWith("runs/")) return Response.json([]);
      }
      return Response.json({ id });
    },
    store: {
      listClients: async () => [{ id: "client-1", name: "Test client", redirectUris: ["http://localhost/callback"], revokedAt: null }],
      revokeClient: async (clientId) => { revoked.push(clientId); },
    },
  });
  try {
    expect(connected.client.getDiscoverResult()).toBeDefined();
    const catalog = await connected.client.listTools();
    expect(catalog.tools.map((tool) => tool.name).sort()).toEqual([
      ...actions.map((action) => action.name),
      "read_artifact", "view_image", "list_mcp_clients", "revoke_mcp_client",
    ].sort());
    expect(catalog.tools.some((tool) => /texture|execute|shell/.test(tool.name))).toBe(false);
    expect(catalog.tools.find((tool) => tool.name === "generate_assets")?.annotations)
      .toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
    expect(catalog.tools.find((tool) => tool.name === "cancel_pending_jobs")?.annotations?.destructiveHint).toBe(true);
    for (const action of actions) {
      const result = await connected.client.callTool({ name: action.name, arguments: action.args });
      expect(result.isError).not.toBe(true);
      expect(requests.at(-1)).toEqual({ method: action.method, path: action.path });
    }
    expect(requests).toHaveLength(40);
    const clients = await connected.client.callTool({ name: "list_mcp_clients", arguments: {} });
    expect(clients.structuredContent).toEqual({ data: [{ id: "client-1", name: "Test client", redirectUris: ["http://localhost/callback"], revokedAt: null }] });
    await connected.client.callTool({ name: "revoke_mcp_client", arguments: { clientId: "client-1" } });
    expect(revoked).toEqual(["client-1"]);
    expect(requests).toHaveLength(40);
  } finally { await connected.close(); }
});

test("scope-filtered catalogs deny direct calls to hidden tools", async () => {
  for (const scope of [read, write, admin]) {
    let calls = 0;
    const connected = await session({ scopes: [scope], api: async () => { calls++; return Response.json({ id }); } });
    try {
      const catalog = await connected.client.listTools();
      expect(catalog.tools.map((tool) => tool.name).sort()).toEqual([
        ...actions.filter((action) => action.scope === scope).map((action) => action.name),
        ...(scope === read ? ["read_artifact", "view_image"] : []),
      ].sort());
      for (const action of actions.filter((action) => action.scope !== scope)) {
        await expect(connected.client.callTool({ name: action.name, arguments: action.args })).rejects.toThrow();
      }
      expect(calls).toBe(0);
    } finally { await connected.close(); }
  }
});

test("shared validation rejects malformed mutation input before calling the application", async () => {
  let calls = 0;
  const connected = await session({ api: async () => { calls++; return Response.json({ id }); } });
  try {
    for (const args of [
      { projectId: "bad", count: 1, judgeIterations: 0 },
      { projectId: id, count: 21, judgeIterations: 0 },
      { projectId: id, count: 1, judgeIterations: -1 },
      { projectId: id, count: 1, judgeIterations: 0, unexpected: true },
    ]) {
      const result = await connected.client.callTool({ name: "generate_assets", arguments: args });
      expect(result.isError).toBe(true);
    }
    const material = await connected.client.callTool({ name: "generate_material", arguments: { projectId: id, parameters: { roughness: 2 } } });
    expect(material.isError).toBe(true);
    expect(calls).toBe(0);
  } finally { await connected.close(); }
});

test("projects, selected history, queue and transcripts paginate without losing control state", async () => {
  const connected = await session({ api: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/api/projects") return Response.json({ projects: [{ id: "p1" }, { id: "p2" }, { id: "p3" }] });
    if (path === "/api/queue") return Response.json({ control: { paused: true }, jobs: [{ id: "j1" }, { id: "j2" }, { id: "j3" }] });
    if (path.startsWith("/api/runs/")) return Response.json([{ type: "start" }, { type: "output" }, { type: "finish" }]);
    return Response.json({ project: { id, status: "ready" }, models: [{ id: "m1" }, { id: "m2" }], revisions: [{ version: 1 }, { version: 2 }, { version: 3 }], runs: [] });
  } });
  try {
    const projects = await connected.client.callTool({ name: "list_projects", arguments: { offset: 1, limit: 1 } });
    expect(projects.structuredContent).toEqual({ data: { projects: [{ id: "p2" }] }, page: { offset: 1, total: 3, nextOffset: 2 } });
    const overview = await connected.client.callTool({ name: "get_project", arguments: { projectId: id } });
    expect(overview.structuredContent).toEqual({ data: { project: { id, status: "ready" }, counts: { models: 2, revisions: 3, runs: 0 } } });
    const revisions = await connected.client.callTool({ name: "get_project", arguments: { projectId: id, section: "revisions", offset: 2, limit: 1 } });
    expect(revisions.structuredContent).toEqual({ data: [{ version: 3 }], page: { offset: 2, total: 3, nextOffset: null } });
    const queue = await connected.client.callTool({ name: "get_queue", arguments: { offset: 0, limit: 1 } });
    expect(queue.structuredContent).toEqual({ data: { control: { paused: true }, jobs: [{ id: "j1" }] }, page: { offset: 0, total: 3, nextOffset: 1 } });
    const events = await connected.client.callTool({ name: "get_run_events", arguments: { runId: id, offset: 1, limit: 2 } });
    expect(events.structuredContent).toEqual({ data: [{ type: "output" }, { type: "finish" }], page: { offset: 1, total: 3, nextOffset: null } });
  } finally { await connected.close(); }
});

test("paid operations return identifiers once and failed drafting preserves recovery context", async () => {
  const paths: string[] = [];
  const connected = await session({ api: async (request) => {
    paths.push(new URL(request.url).pathname);
    return paths.at(-1) === "/api/projects/brief"
      ? Response.json({ error: "Provider unavailable", draftId: id, references: ["references/saved.png"] }, { status: 400 })
      : Response.json({ id }, { status: 201 });
  } });
  try {
    const generated = await connected.client.callTool({ name: "generate_assets", arguments: { projectId: id, count: 1, judgeIterations: 0 } });
    expect(generated.structuredContent).toEqual({ data: { id } });
    const draft = await connected.client.callTool({ name: "draft_project_brief", arguments: { name: "Forest tools" } });
    expect(draft.isError).toBe(true);
    expect(draft.structuredContent).toEqual({ data: { error: "Provider unavailable", draftId: id, references: ["references/saved.png"] } });
    expect(paths).toEqual([`/api/projects/${id}/generate`, "/api/projects/brief"]);
  } finally { await connected.close(); }
});

test("MCP reference bytes become multipart files and explicit reference removal is retained", async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  let received: FormData | undefined;
  const connected = await session({ api: async (request) => { received = await request.formData(); return Response.json({ id }); } });
  try {
    await connected.client.callTool({ name: "create_project", arguments: {
      name: "Forest tools", draftId: id, references: [],
      images: [{ filename: "reference.png", mimeType: "image/png", base64: png.toString("base64") }],
    } });
    expect(received?.get("draftId")).toBe(id);
    expect(received?.get("references")).toBe("[]");
    const file = received?.get("images");
    if (!(file instanceof File)) throw new Error("Expected an uploaded reference");
    expect(file.name).toBe("reference.png");
    expect(file.type).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
  } finally { await connected.close(); }
});

test("legacy HTTP initialization and discovery remain available alongside modern clients", async () => {
  const handler = createMcpHandler(() => createStudioMcpServer({ scopes: [read], publicUrl }), { keepAliveMs: 0 });
  const send = (body: object) => handler.fetch(new Request(new URL("/mcp", publicUrl), {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }, body: JSON.stringify(body),
  }));
  try {
    const initialized = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy-test", version: "1" } } });
    expect(initialized.status).toBe(200);
    expect(await initialized.text()).toContain('"protocolVersion":"2025-11-25"');
    const listed = await send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(listed.status).toBe(200);
    const body = await listed.text();
    expect(body).toContain('"name":"list_projects"');
    expect(body).not.toContain('"name":"generate_assets"');
  } finally { await handler.close(); }
});

test("owner-disabled tools disappear from discovery and cannot be called", async () => {
  const connected = await session({ disabledTools: new Set(["list_projects"]) });
  try {
    const names = (await connected.client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("get_project");
    expect(names).not.toContain("list_projects");
    const called = await connected.client.callTool({ name: "list_projects", arguments: {} }).then(() => "ok", () => "rejected");
    expect(called).toBe("rejected");
  } finally { await connected.close(); }
});

test("the settings catalog lists every tool with its required scope", () => {
  const catalog = studioToolCatalog();
  const scopeOf = (name: string) => catalog.find((tool) => tool.name === name)?.scope;
  expect(scopeOf("list_projects")).toBe(read);
  expect(scopeOf("generate_assets")).toBe(write);
  expect(scopeOf("update_settings")).toBe(admin);
  expect(scopeOf("revoke_mcp_client")).toBe(admin);
});
