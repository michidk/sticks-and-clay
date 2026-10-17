# Connect an agent to Sticks & Clay

Sticks & Clay exposes its workshop through an OAuth-protected HTTP MCP server at `/api/mcp`. Add its full HTTPS URL to your agent's remote MCP connections and choose OAuth authentication. No client secret or manually copied access token is needed.

Use your deployed workshop URL, for example:

```text
https://your-workshop.example/api/mcp
```

The client discovers the authorization server, registers its callback, and opens a browser consent page. On the permanent deployment, log in through Hodor, select the permissions, and authorize. This is the same flow as CodeTend; no separate MCP password is needed. Standalone deployments can instead require a dedicated `MCP_OWNER_PASSWORD` on the consent form. Never paste credentials into a chat or repository file.

## Codex and Claude Code

Register the server in each client's user configuration so it is available across workspaces:

```sh
codex mcp add sticks-and-clay --url https://your-workshop.example/api/mcp
claude mcp add-json --scope user sticks-and-clay '{"type":"http","url":"https://your-workshop.example/api/mcp","oauth":{"scopes":"sticks-and-clay:read sticks-and-clay:write sticks-and-clay:admin"}}'
claude mcp login sticks-and-clay
```

Codex starts OAuth login when adding the server. To reconnect later, run `codex mcp login sticks-and-clay`. Both clients support `mcp login sticks-and-clay --no-browser` for a headless connection. Complete consent and return the callback URL to the waiting client when prompted. Treat callback URLs as credentials until consumed.

The requested scopes make all workshop tools available for owner approval; consent can grant fewer permissions. For a read-only Claude connection, set `oauth.scopes` to `sticks-and-clay:read`. Both clients store and refresh OAuth credentials themselves. Keep access tokens out of configuration and repository files.

Start a new agent session after registration. Check the connection with `codex mcp get sticks-and-clay`, `claude mcp get sticks-and-clay`, or `/mcp` inside either client. Ask the agent to use `list_projects` and `get_queue` as a read-only smoke test.

No companion skill is required. Server instructions, tool descriptions, the `sticks-and-clay://workflow` resource, and the `create_collection` prompt provide the workflow through MCP itself. A client that cannot read resources can still use the tool descriptions and server instructions.

## ChatGPT and the settings panel

Behind Hodor, no `MCP_*` variables are needed: with `HODOR_SECRET` set (32+ characters) the endpoint is `https://<workshop host>/api/mcp`, derived from the proxy's `Host`/`X-Forwarded-*` headers, which Hodor must overwrite. Hodor owner consent and signing with `HODOR_SECRET` are the defaults. Add `https://chatgpt.com` as a custom connector with that URL and OAuth; it is allowed as a browser origin by default (override with `MCP_ALLOWED_ORIGINS`). Setting `MCP_PUBLIC_URL` pins the URL instead.

**Admin → MCP** shows the endpoint with a copy button and one access level (Off, Read only, Read and create, Full access; tools above the level vanish from discovery and cannot be called), connected clients with their scopes and token counts, revoke buttons, and paged tool activity. It needs migration `0019` (`bun run db:migrate`).

## Owner setup

Run the additive database migrations and configure these variables in the app's private environment before starting it:

```dotenv
MCP_PUBLIC_URL=https://your-workshop.example/api/mcp
MCP_OWNER_PASSWORD=<random-secret-at-least-32-characters>
MCP_SECRET=<separate-random-secret-at-least-32-characters>
# Optional browser MCP clients; comma-separated exact origins:
# MCP_ALLOWED_ORIGINS=https://your-client.example
```

`MCP_PUBLIC_URL` must identify `/api/mcp` exactly. HTTPS is required except for loopback HTTP development. The configured URL controls the issuer, audience, Host validation, discovery links, and artifact downloads. Forwarded headers cannot change it. Fixed loopback Host values are also accepted for the managed preview proxy; arbitrary hosts are rejected. `MCP_SECRET` defaults to the owner password if omitted; a separate secret allows rotating the password without invalidating access tokens. Restart the app after configuration changes. Missing or invalid configuration makes MCP paths return 503 while the ordinary app continues running.

```sh
bun run db:migrate
bun run build
bun .output/server/index.mjs
```

For remote connections, route the MCP and OAuth paths to the app without a separate browser login gate. The VibePod deployment routes only these paths directly to its preview gateway; other workshop paths retain Hodor. Use application OAuth authentication on MCP paths. Preserve `Authorization`, `Host`, `Origin`, `MCP-Protocol-Version`, `MCP-Method`, and `MCP-Name` headers. Allow request bodies up to 280 MiB if model imports are needed.

## Hodor deployment

Set `MCP_OWNER_AUTH=hodor` and provide a separate `MCP_SECRET` of at least 32 characters. Omit `MCP_OWNER_PASSWORD`. Hodor must proxy **every** request to the app and overwrite `X-Hodor-Auth`; expose only Hodor through the Service and ingress. Block direct access to the app port with a NetworkPolicy. The app accepts Hodor's `password` and `bypass` admission methods for owner consent.

Keep `/oauth/authorize` behind the login gate. Allow machine clients through Hodor's `BYPASS_PATHS` for `/api/mcp`, `/api/mcp/files`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/api/mcp`, `/oauth/register`, `/oauth/token`, and `/oauth/revoke`. These routes enforce OAuth themselves. Set `PRESERVE_HOST=true`. Consent retains request binding, one-use CSRF tokens, and origin validation after login.

## Permissions

| Scope | Access |
| --- | --- |
| `sticks-and-clay:read` | Projects, saved designs and history, queues, events, artifacts and image pixels. Required for every connection. |
| `sticks-and-clay:write` | Project and design edits, paid drafting/generation, branching, materials, exports, cancellation and recovery. |
| `sticks-and-clay:admin` | Agent/model configuration, runtime settings, diagnostics and connected-client revocation. |

Write and admin permissions start unchecked on the consent page. The owner chooses each grant; admin does not imply write. Clients see only tools allowed by their grant, and direct calls to other tools fail. Read access includes project prompts, run history, files and cost estimates, so grant it only to clients that should see the workshop's content.

There are 42 tools covering existing workshop actions and artifact access. `create_collection` provides a workflow prompt; `sticks-and-clay://workflow` explains generation and recovery. No shell, arbitrary Python execution, internal texture-builder endpoint, filesystem-path import, or history-deletion tool is exposed.

## Working with assets

1. Use `create_project` to queue design generation. Brief/name drafting tools use paid AI and return a recoverable draft ID.
2. Poll `get_project`, review its design, and use `save_design` with its current version and `approve=true` after the user approves it. Stale edits fail. Existing design revisions remain immutable.
3. Use `generate_assets` once per requested batch, then poll its project or queue. The job uses the approved design snapshot. New 3D batches pause for visual-target approval unless `visualTargetMode` is `skip`. Show the user the target, then use `approve_visual_target` with its exact image key, or `revise_visual_target` with their feedback. Review rounds apply to every asset type: a reviewer inspects each rendered graphic or SVG and requests fixes. Zero rounds for 3D retains all four modeling passes. To keep a batch for later, `save_idea` stores the same settings without charge, even before design approval; `mark_idea_ready` marks a finalized idea Ready without starting it, `start_idea` queues it, and `update_idea`/`discard_idea` change unstarted ideas.
4. Inspect saved models, versions and runs using `get_project` sections. Section `board` groups work as `idea`, `ready`, `progress`, `review` and `done`. Show finished assets in Review to the user, then `accept_asset` (a marker; `accepted=false` undoes it) or iterate with `branch_asset`. Use `get_run_events` for paginated transcripts and `view_image` for render pixels. All list tools return `nextOffset` for subsequent pages where pagination applies.
5. Iterate or fork using `branch_asset` and a saved `sourceRunId`. Render views/sprites with `render_asset` or apply a material with `assign_material`. Poll `get_export_job` using the returned job ID. `export_assets` zips every saved file of finished assets (optionally `modelIds`, or `acceptedOnly` for Done items) and returns an artifact key for `read_artifact`.
6. Resume eligible failed work with its recovery tool. Do not repeat successful generation or project-creation calls to check progress. Those calls may create another paid job. Costs already incurred remain after cancellation.

Tools return structured JSON under `data`, plus readable text. Application failures set `isError` and preserve recovery information such as draft IDs. "Completed with issues" remains distinct from judge approval and technical failure.

Reference images accept `{url}` for a public HTTP(S) image, or `{filename,mimeType,base64}` for PNG, JPEG or WebP bytes. URL downloads use the app's SSRF protection. Each image is limited to 8 MiB; retained and newly uploaded references together are limited to six. Omitting `references` retains draft references; `references: []` removes them.

`import_asset` accepts `{filename,base64}` containing a GLB or Blender file up to 200 MiB. Inputs use canonical base64; directories and server filesystem paths are rejected. The HTTP body limit is 280 MiB for write grants and 4 MiB for other grants. Some clients have smaller upload limits.

`read_artifact` returns the format, size, MCP resource URI and an authenticated binary download URL. Download with the connection's bearer token. Resource reads inline at most 16 MiB; `view_image` returns up to 8 MiB of pixels. Large models and ZIP/source bundles use the download endpoint. Only application artifact directories are accessible; runtime settings, dotfiles and traversal paths are rejected.

## Authentication and operations

The server uses authorization-code OAuth with mandatory PKCE S256 and an exact resource binding. Discovery documents are at `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource/api/mcp`. OAuth endpoints are `/oauth/register`, `/oauth/authorize`, `/oauth/token` and `/oauth/revoke`. Registered redirects require HTTPS or loopback HTTP.

Access tokens last 15 minutes. Refresh tokens rotate on use and last 30 days. Replaying a consumed authorization code or refresh token revokes its grant family. PostgreSQL stores code, refresh-token and consent-token hashes, not their raw values. Owner consent uses a signed, short-lived, single-use transaction, an HttpOnly cookie, and Origin checks. Every authenticated request checks persisted revocation state, including downloads.

An admin connection can use `list_mcp_clients` and `revoke_mcp_client`. Revocation ends future access immediately; an already running generation job continues until separately cancelled. Rotating `MCP_SECRET` invalidates existing JWT access tokens, so revoke existing clients too when removing compromised grants. OAuth and tool-call audit records contain client IDs, tool names and outcomes without request payloads or credentials. Audit persistence errors are logged without failing an otherwise completed action.

Back up the OAuth tables with the rest of PostgreSQL and retain asset storage. The application remains a single-owner workshop: its ordinary API relies on the existing private deployment boundary, and generated Blender code runs with the worker's permissions. Expose only the authenticated MCP paths when adding external agents.

## Implementation and verification

`src/server.ts` intercepts MCP/OAuth requests before TanStack Start. The production entry in `src/serve.server.ts` raises Bun's transport body limit to 280 MiB and retains graceful shutdown hooks. `src/modules/mcp/` owns the protocol, tool adapters, artifact access and OAuth modules. Tools reuse the existing API and shared input contracts. The official stable TypeScript SDK v2 serves the 2026-07-28 protocol and stateless 2025-era Streamable HTTP clients.

The implementation uses the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and [MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization). Owner authentication uses a dedicated secret; ingress identity headers do not grant access.

```sh
bun run verify
# Use an isolated migrated PostgreSQL database with no running worker:
TEST_DATABASE=1 DATABASE_URL=postgres://... bun test src/modules/mcp src/lib/api.integration.test.ts
```

Tests exercise the official SDK client, current and legacy transport, permission filtering, upload validation, artifact boundaries, OAuth consent/PKCE/resource binding, refresh replay, durable atomic consumption, immediate revocation, and real API approval/version conflicts. They do not call paid AI providers.
