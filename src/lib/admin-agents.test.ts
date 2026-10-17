import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

test("agent PATCH saves one role or several in a single write", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "studio-agents-"));
  const previous = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = dir;
  try {
    const { adminAction } = await import("./admin.server");
    const patch = async (body: unknown) =>
      (await adminAction(new Request("http://x/api/admin/agents", { method: "PATCH", body: JSON.stringify(body) }), ["agents"]))!;
    const rows = async (response: Response) => (await response.json()).agents as { id: string; model: string; effort: string }[];
    const find = (list: { id: string }[], id: string) => list.find((agent) => agent.id === id) as any;

    const single = await rows(await patch({ id: "builder", engine: "eve", model: "claude-opus-5-5", effort: "high" }));
    expect(find(single, "builder").model).toBe("claude-opus-5-5");

    const bulk = await rows(await patch({ agents: [
      { id: "judge", engine: "eve", model: "claude-sonnet-5-5", effort: "low" },
      { id: "project-name", engine: "tanstack", model: "claude-haiku-5-5", effort: "medium" },
    ] }));
    expect(find(bulk, "judge")).toMatchObject({ model: "claude-sonnet-5-5", effort: "low" });
    expect(find(bulk, "project-name").model).toBe("claude-haiku-5-5");
    expect(find(bulk, "builder").model).toBe("claude-opus-5-5");

    await expect(patch({ agents: [{ id: "judge", engine: "tanstack", model: "x", effort: "low" }] })).rejects.toThrow("mismatched");
  } finally {
    if (previous === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
