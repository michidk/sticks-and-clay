import { expect, test, spyOn } from "bun:test";
import { workspaceTool } from "../../eve/agent/tools/asset_workspace";

test("native workspace authoring bypasses MCP and carries cancellation and scoped capability", async () => {
  const previous = process.env.BLENDER_MCP_URL;
  const previousRunner = process.env.BLENDER_RUNNER_URL;
  delete process.env.BLENDER_RUNNER_URL;
  process.env.BLENDER_MCP_URL = "http://127.0.0.1:33499/mcp";
  const controller = new AbortController();
  const capability = crypto.randomUUID();
  const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ sha256: "a".repeat(64), saved: true }),
  );
  try {
    const input = {
      capability,
      operation: "write",
      code: "finish_asset()",
      mode: "quick",
    };
    const result = await (workspaceTool.execute as any)(input, {
      abortSignal: controller.signal,
    });
    expect(result.saved).toBe(true);
    const [url, options] = fetchMock.mock.calls[0] as any;
    expect(url).toBe("http://127.0.0.1:33499/workspace");
    expect(options.signal).toBe(controller.signal);
    expect(JSON.parse(options.body)).toEqual(input);
    fetchMock.mockResolvedValue(
      Response.json(
        { error: "Asset script changed; read the current source" },
        { status: 400 },
      ),
    );
    await expect((workspaceTool.execute as any)(input, {})).rejects.toThrow(
      "Asset script changed",
    );
  } finally {
    fetchMock.mockRestore();
    if (previous === undefined) delete process.env.BLENDER_MCP_URL;
    else process.env.BLENDER_MCP_URL = previous;
    if (previousRunner === undefined) delete process.env.BLENDER_RUNNER_URL;
    else process.env.BLENDER_RUNNER_URL = previousRunner;
  }
});
