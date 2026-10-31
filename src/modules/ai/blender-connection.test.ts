import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import connection from "../../../eve/agent/connections/blender";
import renderTool from "../../../eve/agent/tools/view_render";

test("Blender is available only to the builder and photographer with their own operations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blender-connection-"));
  const previousData = process.env.STUDIO_DATA_DIR;
  process.env.STUDIO_DATA_DIR = directory;
  const resolver = connection.events["turn.started"];
  const renderResolver = renderTool.events["turn.started"];
  if (!resolver || !renderResolver) throw new Error("Missing role resolver");
  try {
    await mkdir(join(directory, "session-config"));
    for (const role of ["judge", "production-planner", "builder", "photographer"]) {
      await writeFile(join(directory, "session-config", "fixture.json"), JSON.stringify({ role }));
      const resolved = await resolver({}, {
        session: { id: "fixture", auth: { current: null, initiator: null } },
        channel: {}, model: null, messages: [],
      });
      const render = await renderResolver({}, {
        session: { id: "fixture", auth: { current: null, initiator: null } },
        channel: {}, model: null, messages: [],
      });
      if (role === "builder" || role === "photographer") expect(render).not.toBeNull();
      else expect(render).toBeNull();
      if (role === "builder")
        expect(resolved).toMatchObject({ tools: { allow: ["get_scene_info", "execute_blender_code"] } });
      else if (role === "photographer")
        expect(resolved).toMatchObject({ tools: { allow: ["get_scene_info", "photograph_asset"] } });
      else expect(resolved).toBeNull();
    }
  } finally {
    if (previousData === undefined) delete process.env.STUDIO_DATA_DIR;
    else process.env.STUDIO_DATA_DIR = previousData;
    await rm(directory, { recursive: true, force: true });
  }
});
