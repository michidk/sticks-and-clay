import { expect, test } from "bun:test";
import { workspaceTool } from "../../eve/agent/tools/asset_workspace";

test("workspace HTTP requests preserve scoped inputs, errors, and cancellation", async () => {
  const previous = process.env.BLENDER_RUNNER_URL;
  const previousMcp = process.env.BLENDER_MCP_URL;
  const received: unknown[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    expect(new URL(request.url).pathname).toBe("/workspace");
    received.push(await request.json());
    if (received.length === 2)
      return Response.json({ error: "Asset script changed" }, { status: 400 });
    await Bun.sleep(100);
    return Response.json({ completed: true });
  } });
  delete process.env.BLENDER_RUNNER_URL;
  process.env.BLENDER_MCP_URL = new URL("/mcp", server.url).href;
  const input = { capability: crypto.randomUUID(), operation: "run", mode: "final" };
  try {
    expect(await (workspaceTool.execute as any)(input, {})).toEqual({ completed: true });
    expect(received[0]).toEqual(input);
    process.env.BLENDER_RUNNER_URL = new URL("/workspace", server.url).href;
    await expect((workspaceTool.execute as any)(input, {})).rejects.toThrow("Asset script changed");
    await expect((workspaceTool.execute as any)(input, {
      abortSignal: AbortSignal.timeout(30),
    })).rejects.toThrow();
  } finally {
    server.stop(true);
    if (previous === undefined) delete process.env.BLENDER_RUNNER_URL;
    else process.env.BLENDER_RUNNER_URL = previous;
    if (previousMcp === undefined) delete process.env.BLENDER_MCP_URL;
    else process.env.BLENDER_MCP_URL = previousMcp;
  }
});
