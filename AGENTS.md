# Sticks & Clay agent guide

Sticks & Clay is a single-owner, self-hosted AI asset-generation pipeline with
a human in the loop. It is a Bun/TypeScript application using React 19,
TanStack Start/Router, Vite, Tailwind 4, shadcn/ui, Drizzle/PostgreSQL, the Eve
agent runtime, and isolated Blender processes. Three.js displays exported
GLBs. An OAuth-protected MCP server exposes the workshop to external agents.

## Sources of truth

- Product overview, setup, and entry points: `README.md`
- Services, deployment, persistence, and verification: `docs/development.md`
- MCP tools, scopes, OAuth, and deployment: `docs/mcp.md`
- Generation passes, reviews, and recovery: `docs/quality-pipeline.md`
- AI roles, providers, accounting, and durable execution: `docs/ai-architecture.md`
- Materials, sprites, imports, and source bundles: `docs/asset-workshop.md`
- GLB cleanup and analysis: `docs/model-processing.md`; viewer: `docs/model-viewer.md`
- Authored prompts and attribution: `prompts/README.md`
- Visual and interaction rules: `design.md`
- Database schema: `src/db/schema.ts`

Do not duplicate configuration tables, tool lists, or deployment steps here.
Update the source-of-truth document together with the behavior it describes.

Update `README.md` when a change affects what it advertises: features, asset
types, human checkpoints, MCP capabilities (including the tool count), setup,
commands, the technology stack, or documentation entry points. Keep its claims
accurate and do not describe planned work as shipped. README screenshots live
in `.github/images/`; when a change makes one visibly outdated, recapture it
from the running app at 1280×800 (phone shots at 390px wide), hide
environment-only banners, and replace internal hostnames with
`studio.example.com`.

## Working tree

Inspect the working tree before editing and preserve unrelated work. Treat
`.codex/`, `.claude/`, `.serena/`, `.agents/`, and `.gitnexus/` as user-local
tool state; do not inspect or commit them unless explicitly requested. Follow
the enclosing environment's Git instructions and never invent a remote.

## Code map and boundaries

- `src/routes/`: file routes, root shell, project workspace, and admin pages.
  Keep project-only components in `src/routes/projects/$projectId/-components/`.
- `src/components/`: UI shared between routes; `src/components/ui/`: shadcn
  primitives and the model viewer; `src/styles.css`: shared theme tokens.
- `src/lib/client.ts`: browser API helpers. Keep database access, credentials,
  filesystem operations, and agent execution in server modules, never in
  client bundles.
- `src/lib/api.server.ts`: request validation and API behavior;
  `src/lib/contracts.ts`: shared validation and domain contracts.
- `src/lib/pipeline.server.ts`: workflow coordination and asset-specific
  handlers; `src/modules/pipelines/index.ts`: provider-independent traversal
  and the model review sequence.
- `src/modules/ai/`: all AI work goes through `index.server.ts` (`runRole`,
  `roleInput`); roles live in `roles.ts`. Callers must not import adapter
  internals such as `internal/eve.server.ts` or `internal/tanstack.server.ts`.
- `src/modules/mcp/`: MCP protocol, tool adapters, artifact access, and OAuth.
  `src/server.ts` intercepts MCP/OAuth requests before TanStack Start.
- `src/lib/checkpoint.server.ts` and recovery modules: durable execution and
  restart behavior; `scripts/worker.ts` claims queued PostgreSQL jobs.
- `src/db/schema.ts` and `drizzle/`: schema and migrations.
- `prompts/`: authored instructions and input templates. Shared Eve
  instructions require an Eve rebuild and restart when changed.
- `eve/agent/` and `blender/`: agent tools and isolated Blender
  execution, export, analysis, and material helpers.

Keep changes within the affected feature instead of introducing unrelated
restructuring.

## Generated and stateful files

- Never hand-edit `src/routeTree.gen.ts` or build output (`.output/`,
  `eve/.output/`).
- Change `src/db/schema.ts` first, run `bun run db:generate`, inspect the
  generated SQL, and commit the migration with its Drizzle metadata.
- Keep `.env`, credentials, `data/`, Eve session storage, and generated assets
  out of commits.
- PostgreSQL, `data/`, and Eve session storage form one recoverable state.
  Never delete volumes, projects, or history as cleanup.

## Behavior to preserve

- **Human checkpoints stay human.** Design approval, visual-target approval
  (unless the owner chose to skip it), and accepting assets are explicit
  owner decisions. The MCP server instructions tell agents to show the user
  the design or target and approve only after the user has; keep that
  wording when editing them.
- Generation uses an approved design snapshot. Later edits must not change an
  existing batch's contract.
- Design revisions, model attempts, and iteration artifacts retain their
  history. Restoring a design creates a draft; saving creates a new revision.
- For new v4 jobs, zero judge rounds retains the four modeling passes without
  judging; saved v1–v3 jobs keep their original build counts. A passing review
  ends early; exhausted review rounds can finish with issues, which differs
  from approval and from a technical failure.
- Retry and resume have different semantics. Preserve checkpoints, Eve
  session identity, idempotent event accounting, and recovery behavior when
  changing durable jobs.
- Keep GLB/source files, metrics, and product renders associated with the
  correct attempt and iteration. Builds run in isolated Blender processes and
  directories.
- Costs remain estimates with snapshotted rates and usage provenance. Failed
  attempts remain part of history and accounting.
- Preserve the image transport contract and its vision regression tests when
  changing Eve tools or messages.

## MCP rules

- Tools reuse the existing API and shared input contracts in
  `src/lib/contracts.ts`; do not add a parallel code path for agents.
- Every tool belongs to exactly one scope (`read`, `write`, `admin`). Anything
  that spends money, runs Blender, or changes data needs `write`; settings,
  diagnostics, and client management need `admin`.
- Never expose a shell, arbitrary Python execution, server filesystem paths,
  or history deletion through MCP. Keep artifact access inside application
  artifact directories.
- When adding, removing, or renaming a tool, update its tests in
  `src/modules/mcp/`, the workflow resource or server instructions if the
  agent workflow changes, and the tool count in `docs/mcp.md` and `README.md`.
- Keep OAuth behavior intact: PKCE S256, exact resource binding, refresh
  rotation with replay revocation, and revocation checks on every request.

## UI rules

Follow `design.md`: warm ivory surfaces, forest-green actions, sage supporting
colors, thin borders, restrained shadows, and the existing responsive grids.
Use the shadcn primitives in `src/components/ui/` and semantic tokens from
`src/styles.css`; keep app-specific layouts in the routes. Use the skeletons
in `src/components/loading.tsx` for initial loading and keep loaded content
during polling. Retain explicit empty, error, review, and disabled states.
Keep keyboard focus and semantic controls usable.

## Commands

```sh
bun install --frozen-lockfile
bun run dev --port 3000      # web app
bun run services             # Eve, Blender MCP, and the worker
bun run db:migrate
bun run db:generate
bun run typecheck
bun run test
bun run build
bun run eve:typecheck
bun run eve:build
bun run verify               # typecheck, test, build, eve:typecheck
```

## Required verification

- Documentation-only change: check content and relative links, then run
  `git diff --check`. Do not run paid generation to validate prose.
- TypeScript logic change: targeted tests, `bun run typecheck`, and
  `bun run test`.
- Route or UI change: the TypeScript checks plus a pass in the collaborative
  browser at desktop and phone widths, including console errors.
- Database, API, MCP, or recovery change: the relevant integration tests
  against an isolated migrated PostgreSQL database with no running worker,
  for example `TEST_DATABASE=1 bun test src/lib/api.integration.test.ts` or
  `TEST_DATABASE=1 bun test src/modules/mcp`. Read the test setup first.
- Eve configuration or shared instruction change: `bun run eve:build`.
- Python or Blender change: `ruff check blender scripts` and the Python
  unittest suites listed in `.github/workflows/verify.yml`.
- Before handing off a broad change: `bun run verify`.

Do not claim integration, Blender, or browser coverage that was skipped.

## Local services and previews

Use Docker Compose for PostgreSQL. In the existing VibePod environment,
`docker compose -p studio up -d --wait` reuses the established database
volume. Inspect running services before launching another supervisor;
`scripts/services.sh` runs Eve, Blender MCP, and the worker, and logs to
`data/logs/`.

In VibePod, check `vibepod-preview list` and reuse the `asset-studio` preview;
use `vibepod-preview restart asset-studio` if it is stopped. Create a missing
preview through `vibepod-preview run` with `asset-studio` as its stable name,
following `docs/development.md`. Run `vibepod-preview doctor asset-studio`
before reporting it healthy.

## Security boundary

This is a trusted single-owner workshop. Generated Blender Python executes
with the service user's permissions and is not sandboxed by the operating
system. Keep Eve and Blender on loopback, keep the web UI behind an
authenticating proxy, and expose only the OAuth-protected MCP paths to
external agents. Do not turn it into a public multi-tenant service without a
separate security design.
