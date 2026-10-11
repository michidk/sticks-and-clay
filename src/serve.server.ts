import { serve } from "srvx/bun";
import { useNitroApp, useNitroHooks } from "nitro/app";
import { MAX_MCP_BODY_BYTES } from "./modules/mcp/catalog";

const port = Number.parseInt(process.env.NITRO_PORT ?? process.env.PORT ?? "3000");
const server = serve({
  fetch: useNitroApp().fetch,
  port: Number.isNaN(port) ? 3000 : port,
  hostname: process.env.NITRO_HOST || process.env.HOST,
  maxRequestBodySize: MAX_MCP_BODY_BYTES,
  tls: process.env.NITRO_SSL_CERT && process.env.NITRO_SSL_KEY
    ? { cert: process.env.NITRO_SSL_CERT, key: process.env.NITRO_SSL_KEY } : undefined,
});
const close = server.close.bind(server);
let closeHooks: Promise<void> | undefined;
server.close = (active) => close(active).finally(() => closeHooks ??= (async () => {
  await useNitroHooks().callHook("close");
})());
export default {};
