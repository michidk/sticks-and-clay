import { defineDynamic, defineMcpClientConnection } from "eve/connections";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      const config = z.object({ role: z.string() }).parse(JSON.parse(
        await readFile(resolve(
          process.env.STUDIO_DATA_DIR || "../data",
          "session-config",
          ctx.session.id + ".json",
        ), "utf8"),
      ));
      if (config.role !== "builder" && config.role !== "photographer") return null;
      return defineMcpClientConnection({
        url: process.env.BLENDER_MCP_URL || "http://127.0.0.1:33442/mcp",
        protocolVersionDiscovery: false,
        description:
          "Isolated Blender workspaces. Use the capability from the builder or photographer task.",
        tools: {
          allow: config.role === "builder"
            ? ["get_scene_info", "execute_blender_code"]
            : ["get_scene_info", "photograph_asset"],
        },
      });
    },
  },
});
