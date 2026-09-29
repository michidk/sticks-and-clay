import { defineMcpClientConnection } from "eve/connections";
export default defineMcpClientConnection({
  url: process.env.BLENDER_MCP_URL || "http://127.0.0.1:33442/mcp",
  protocolVersionDiscovery: false,
  description:
    "Isolated Blender workspaces. Inspect scene/version, execute a complete bpy build script, and inspect rendered images. Use the capability from the builder or photographer task.",
  tools: { allow: ["get_scene_info", "execute_blender_code", "photograph_asset"] },
});
