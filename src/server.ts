import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { DEMO_MODE } from "./lib/build-mode";
import { handleMcpHttpRequest } from "./modules/mcp/index.server";

const start = createStartHandler(defaultStreamHandler);
export default {
  async fetch(request: Request) {
    // The demo's only security boundary: every write, paid action and MCP/OAuth request is refused here.
    if (DEMO_MODE)
      return request.method === "GET" || request.method === "HEAD"
        ? await start(request)
        : Response.json({ error: "This is a read-only demo. Changes are disabled." }, { status: 403 });
    return await handleMcpHttpRequest(request) ?? await start(request);
  },
};
