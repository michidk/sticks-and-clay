import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { handleMcpHttpRequest } from "./modules/mcp/index.server";

const start = createStartHandler(defaultStreamHandler);
export default {
  async fetch(request: Request) {
    return await handleMcpHttpRequest(request) ?? await start(request);
  },
};
