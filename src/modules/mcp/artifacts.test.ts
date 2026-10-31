import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createStudioMcpServer } from "./tools.server";

const publicUrl = new URL("https://studio.example");
type ReadFile = NonNullable<Parameters<typeof createStudioMcpServer>[0]["readFile"]>;

async function session(readFile: ReadFile) {
  const handler = createMcpHandler(() => createStudioMcpServer({
    scopes: ["sticks-and-clay:read"], publicUrl, readFile,
    api: async () => { throw new Error("Artifact reads must not call the application API"); },
  }), { keepAliveMs: 0 });
  const client = new Client({ name: "artifact-test", version: "1" }, {
    versionNegotiation: { mode: { pin: "2026-07-28" } },
  });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", publicUrl), {
      fetch: (input, init) => handler.fetch(new Request(input, init)),
    }));
  } catch (error) {
    await client.close(); await handler.close(); throw error;
  }
  return { client, close: async () => { await client.close(); await handler.close(); } };
}

test("artifact links round-trip encoded keys and binary or text resources", async () => {
  const keys: string[] = [];
  const connected = await session(async (key) => {
    keys.push(key);
    return new Blob([key.endsWith(".json") ? '{"triangles":12}' : new Uint8Array([0, 1, 255])]);
  });
  try {
    const artifact = await connected.client.callTool({ name: "read_artifact", arguments: { key: "versions/one/Axe #1.glb" } });
    expect(artifact.structuredContent).toEqual({ data: {
      key: "versions/one/Axe #1.glb", mimeType: "model/gltf-binary", sizeBytes: 3,
      downloadUrl: "https://studio.example/api/mcp/files/versions/one/Axe%20%231.glb",
      resourceUri: "sticks-and-clay://files/versions%2Fone%2FAxe%20%231.glb",
    } });
    expect(artifact.content).toContainEqual({ type: "resource_link", uri: "sticks-and-clay://files/versions%2Fone%2FAxe%20%231.glb", name: "Axe #1.glb", mimeType: "model/gltf-binary", size: 3 });
    const binary = await connected.client.readResource({ uri: "sticks-and-clay://files/versions%2Fone%2FAxe%20%231.glb" });
    expect(binary.contents).toEqual([{ uri: "sticks-and-clay://files/versions%2Fone%2FAxe%20%231.glb", mimeType: "model/gltf-binary", blob: "AAH/" }]);
    const text = await connected.client.readResource({ uri: "sticks-and-clay://files/materials%2Fone%2Foutput%2Fmaterial.json" });
    expect(text.contents).toEqual([{ uri: "sticks-and-clay://files/materials%2Fone%2Foutput%2Fmaterial.json", mimeType: "application/json", text: '{"triangles":12}' }]);
    const assignment = await connected.client.callTool({ name: "read_artifact", arguments: { key: "assignments/one/asset.glb" } });
    expect(assignment.isError).not.toBe(true);
    expect(keys).toEqual(["versions/one/Axe #1.glb", "versions/one/Axe #1.glb", "materials/one/output/material.json", "assignments/one/asset.glb"]);
    expect((await connected.client.listResourceTemplates()).resourceTemplates.map((template) => template.uriTemplate))
      .toEqual(["sticks-and-clay://files/{key}"]);
  } finally { await connected.close(); }
});

test("artifact tools and resource reads reject traversal and internal state before storage access", async () => {
  let reads = 0;
  const connected = await session(async () => { reads++; return new Blob(["private"]); });
  try {
    for (const key of [
      "capabilities/one.json", "postgres/database", "runtime-settings.json", "models/../runtime-settings.json",
      "models/%2e%2e/runtime-settings.json", "models/.secret", "/etc/passwd", "models\\source.glb",
      "cad/abc/def/support/runner.py", "cad/abc/def/0/process.log", "cad/abc/def/0/spec.json",
      "starting-points/abc/def/process.log", "starting-points/abc/def/runner.py",
    ]) {
      const tool = await connected.client.callTool({ name: "read_artifact", arguments: { key } });
      expect(tool.isError).toBe(true);
      await expect(connected.client.readResource({ uri: `sticks-and-clay://files/${encodeURIComponent(key)}` })).rejects.toThrow();
    }
    expect(reads).toBe(0);
  } finally { await connected.close(); }
});

test("image viewing returns pixels and enforces the 8 MiB inline boundary", async () => {
  const connected = await session(async (key) => new Blob([
    key === "references/small.png" ? new Uint8Array([137, 80, 78, 71])
      : new Uint8Array(8 * 1024 * 1024 + (key.includes("over") ? 1 : 0)),
  ]));
  try {
    const image = await connected.client.callTool({ name: "view_image", arguments: { key: "references/small.png" } });
    expect(image.content).toEqual([{ type: "image", mimeType: "image/png", data: "iVBORw==" }]);
    const maximum = await connected.client.callTool({ name: "view_image", arguments: { key: "references/max.png" } });
    expect(maximum.isError).not.toBe(true);
    const oversized = await connected.client.callTool({ name: "view_image", arguments: { key: "references/over.png" } });
    expect(oversized.isError).toBe(true);
    expect(oversized.structuredContent).toEqual({ data: { error: "Image exceeds the 8 MiB inline limit; use read_artifact" } });
    const model = await connected.client.callTool({ name: "view_image", arguments: { key: "versions/one/asset.glb" } });
    expect(model.structuredContent).toEqual({ data: { error: "Choose a PNG, JPEG or WebP artifact" } });
  } finally { await connected.close(); }
});

test("resource reads enforce 16 MiB while large artifact links remain usable", async () => {
  const connected = await session(async (key) => new Blob([new Uint8Array(16 * 1024 * 1024 + (key.includes("over") ? 1 : 0))]));
  try {
    const maximum = await connected.client.readResource({ uri: "sticks-and-clay://files/versions%2Fone%2Fmax.glb" });
    expect(maximum.contents).toHaveLength(1);
    const content = maximum.contents[0];
    if (!content || !("blob" in content)) throw new Error("Expected a binary resource");
    expect(Buffer.from(content.blob, "base64").byteLength).toBe(16 * 1024 * 1024);
    await expect(connected.client.readResource({ uri: "sticks-and-clay://files/versions%2Fone%2Fover.glb" }))
      .rejects.toThrow("exceeds 16 MiB");
    const link = await connected.client.callTool({ name: "read_artifact", arguments: { key: "versions/one/over.glb" } });
    expect(link.isError).not.toBe(true);
    expect(link.structuredContent).toEqual({ data: {
      key: "versions/one/over.glb", mimeType: "model/gltf-binary", sizeBytes: 16 * 1024 * 1024 + 1,
      downloadUrl: "https://studio.example/api/mcp/files/versions/one/over.glb",
      resourceUri: "sticks-and-clay://files/versions%2Fone%2Fover.glb",
    } });
  } finally { await connected.close(); }
});

test("artifacts can be reconstructed through bounded MCP tool responses without a bearer token", async () => {
  const bytes = Buffer.alloc(1024 * 1024 + 17);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const connected = await session(async () => new Blob([bytes]));
  const output = z.object({ data: z.object({
    sizeBytes: z.number(),
    chunk: z.object({ offset: z.number(), base64: z.string(), nextOffset: z.number().nullable(), sha256: z.string() }),
  }) });
  try {
    const chunks: Buffer[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const response = await connected.client.callTool({ name: "read_artifact", arguments: { key: "graphics/fixture/image.png", offset } });
      expect(response.isError).not.toBe(true);
      expect(JSON.stringify(response).length).toBeLessThan(40000);
      const { data } = output.parse(response.structuredContent);
      expect(data.sizeBytes).toBe(bytes.length);
      expect(data.chunk.offset).toBe(offset);
      expect(data.chunk.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      const chunk = Buffer.from(data.chunk.base64, "base64");
      expect(chunk.length).toBeGreaterThan(0);
      expect(chunk.length).toBeLessThanOrEqual(12 * 1024);
      chunks.push(chunk);
      expect(data.chunk.nextOffset).toBe(offset + chunk.length < bytes.length ? offset + chunk.length : null);
      offset = data.chunk.nextOffset;
    }
    expect(Buffer.concat(chunks)).toEqual(bytes);
  } finally { await connected.close(); }
});

test("artifact chunk offsets validate bounds and support an empty file or end of file", async () => {
  let reads = 0;
  const connected = await session(async (key) => { reads++; return new Blob([key.includes("empty") ? "" : "abc"]); });
  try {
    for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect((await connected.client.callTool({ name: "read_artifact", arguments: { key: "graphics/fixture/image.png", offset } })).isError).toBe(true);
    }
    expect(reads).toBe(0);
    expect((await connected.client.callTool({ name: "read_artifact", arguments: { key: "graphics/fixture/image.png", offset: 4 } })).isError).toBe(true);
    for (const [key, offset] of [["graphics/fixture/image.png", 3], ["exports/empty.zip", 0]] as const) {
      const response = await connected.client.callTool({ name: "read_artifact", arguments: { key, offset } });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toMatchObject({ data: { chunk: { offset, base64: "", nextOffset: null } } });
    }
    const denied = await connected.client.callTool({ name: "read_artifact", arguments: { key: "runtime-settings.json", offset: 0 } });
    expect(denied.isError).toBe(true);
    expect(reads).toBe(3);
  } finally { await connected.close(); }
});
