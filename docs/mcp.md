# Connect an agent to Sticks & Clay

Sticks & Clay exposes its workshop through a Streamable HTTP MCP server at `/api/mcp`. It is **stateless** (every request stands alone; no session ids or server-sent streams) and serves MCP protocol **2026-07-28**, with the SDK's stateless fallback for 2025-era clients.

**There is no authentication.** Anyone who can reach `/api/mcp` can use every enabled tool, including paid generation and Blender execution. Restrict network access instead:

- The server binds to `127.0.0.1` unless `HOST` is set. The container image sets `HOST=0.0.0.0`; then publish the port only on loopback (`-p 127.0.0.1:3000:3000`) or restrict it with a firewall, a NetworkPolicy or a private VPN such as Tailscale or WireGuard.
- Do not route `/api/mcp` through a public ingress.
- Every MCP request must pass **Host** and **Origin** validation (DNS-rebinding defence): anything else gets 403. Loopback and the `MCP_PUBLIC_URL` hostname are always allowed; add more with `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` (comma-separated hostnames, no scheme or port). Requests without an `Origin` header (non-browser clients) pass.

## Codex and Claude Code

```sh
codex mcp add sticks-and-clay --url http://127.0.0.1:3000/api/mcp
claude mcp add --transport http --scope user sticks-and-clay http://127.0.0.1:3000/api/mcp
```

No login step is needed. Start a new agent session, check with `codex mcp get sticks-and-clay`, `claude mcp get sticks-and-clay` or `/mcp`, and ask the agent to use `list_projects` and `get_queue` as a smoke test. Remote clients on your private network use that network's hostname, which must be listed in `MCP_PUBLIC_URL` or `MCP_ALLOWED_HOSTS`.

No companion skill is required. Server instructions, tool descriptions, the `sticks-and-clay://workflow` resource, and the `create_collection` prompt provide the workflow through MCP itself.

**Admin → MCP** shows the endpoint, one access level (Off, Read only, Read and create, Full access; tools above the level vanish from discovery and cannot be called) and paged tool activity.

## Owner setup

```dotenv
MCP_PUBLIC_URL=http://your-workshop.internal:3000/api/mcp
# MCP_ALLOWED_HOSTS=
# MCP_ALLOWED_ORIGINS=
# MCP_SECRET=<random-secret-at-least-32-characters>
```

`MCP_PUBLIC_URL` must identify `/api/mcp` exactly, over HTTP or HTTPS. Without it the URL follows the request's Host, but only loopback hosts are accepted. `MCP_SECRET` signs artifact download links; unset, a random per-process key is used (links then do not survive a restart or span replicas). Restart after configuration changes. Run `bun run db:migrate`, `bun run build`, then `bun .output/server/index.mjs`. Allow request bodies up to 280 MiB if model imports are needed.

## Tools and artifacts

All tools are available to every connection; the Admin → MCP level and per-tool switches are the only gate. `read_artifact` returns the format, size, MCP resource URI, `downloadUrl` and `downloadExpiresAt`. Save the file with an ordinary HTTP GET to `downloadUrl`.

Download links are HMAC-signed, bound to one artifact, and expire after five minutes. Rotating `MCP_SECRET` or pausing MCP invalidates outstanding links. Treat the URL as a temporary credential. Responses use `private, no-store`, attachment disposition and `Referrer-Policy: no-referrer`. Only application artifact directories are accessible; runtime settings, dotfiles and traversal paths are rejected.

Tool-call audit records contain tool names and outcomes without request payloads. Audit persistence errors are logged without failing an otherwise completed action. Generated Blender code runs with the worker's permissions, which is why network restriction matters.

## Implementation and verification

`src/server.ts` intercepts MCP requests before TanStack Start. The production entry in `src/serve.server.ts` raises Bun's body limit to 280 MiB. `src/modules/mcp/` owns the protocol, tool adapters and artifact access. Tools reuse the existing API and shared input contracts. The official TypeScript SDK (`@modelcontextprotocol/server` 2.4+) serves the transport.

```sh
bun run verify
# Use an isolated migrated PostgreSQL database with no running worker:
TEST_DATABASE=1 DATABASE_URL=postgres://... bun test src/modules/mcp src/lib/api.integration.test.ts
```

`update_workshop` accepts optional `svgIntent` (`icon`, `logo` or `illustration`) for SVG projects; omit it to keep the saved intent, and batches without one are icons. It also accepts optional `resolution: { width, height }` for graphic and pixel-art projects. Asset creation, updates and generation accept the same override. Omit it on creation or use `null` to inherit the project setting; omitted resolution and imageSize fields on updates preserve the saved values; use `null` in `update_workshop` to clear the project default. Sizes are frozen into new batches and included in prompts. Pixel dimensions are 4–128; graphic requests are 4–8192 and remain subject to image-provider output limits. SVG generation assumes square vectors.

Agents must change or clear output dimensions only at the owner's explicit request. Unsupported sizes and output mismatches finish with a visible dimension finding for review, not a failed job or an automatic size substitution. A mismatched artifact remains available for inspection; a provider rejection may leave no new artifact.
