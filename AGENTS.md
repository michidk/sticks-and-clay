# Working on Asset Studio

## Start here

Read `README.md` for setup, runtime services, workflow, and persistence. Read `design.md` before changing UI. This is a Bun/TypeScript application using React 19, TanStack Start/Router, Vite, Tailwind 4, Drizzle/PostgreSQL, Eve, and Blender. Three.js displays exported GLBs.

Inspect the working tree before editing and preserve unrelated work. Treat `.codex/`, `.claude/`, `.serena/`, `.agents/`, and `.gitnexus/` as user-local tool state; do not inspect or commit them unless explicitly requested. Follow the enclosing environment's Git instructions; never invent a remote when none is configured.

## Code map and boundaries

- `src/routes/`: file routes, shared root shell, and project workspace. Keep project-only components in `src/routes/projects/$projectId/-components/`.
- `src/components/`: UI shared between routes; `src/styles.css`: shared application theme.
- `src/lib/client.ts`: browser API helpers. Keep database access, credentials, filesystem operations, and agent execution in server modules, not client bundles.
- `src/lib/api.server.ts`: request validation and API behavior; `src/lib/contracts.ts`: shared validation and domain contracts.
- `src/lib/pipeline.server.ts`: workflow coordination; `src/modules/ai/internal/eve.server.ts`: Eve integration; `src/modules/ai/internal/tanstack.server.ts`: direct structured model calls.
- `src/lib/checkpoint.server.ts` and recovery modules: durable execution and restart behavior. `scripts/worker.ts` claims queued PostgreSQL jobs.
- `src/db/schema.ts` and `drizzle/`: schema and migrations. Use `bun run db:generate` for schema changes and inspect generated SQL before applying it.
- `prompts/`: authored instructions and input templates; see `prompts/README.md`. Shared Eve instructions require an Eve rebuild/restart when changed.
- `eve/agent/` and `blender/`: agent tools and isolated Blender execution/export helpers.

Do not hand-edit `src/routeTree.gen.ts` or generated build output. Keep changes within the affected feature instead of introducing unrelated restructuring.

## Behavior to preserve

- Generation uses an approved design snapshot. Later edits must not change an existing batch's contract.
- Design revisions, model attempts, and iteration artifacts retain their history. Restoring a design creates a draft; saving creates a new revision.
- Zero judge rounds means one build without judging. A passing review ends early; exhausted review rounds can finish with issues, which is different from approval or a technical failure.
- Retry and resume have different semantics. Preserve checkpoints, Eve session identity, idempotent event accounting, and recovery behavior when changing durable jobs.
- Keep GLB/source files, metrics, and product renders associated with the correct attempt and iteration. Builds run in isolated Blender processes and directories.
- Costs remain estimates with snapshotted rates and usage provenance. Failed attempts remain part of history and accounting.
- Preserve the image transport contract and its vision regression tests when changing Eve tools or messages.

## UI work

Follow `design.md`: warm ivory surfaces, forest-green actions, sage supporting colors, thin borders, restrained shadows, and existing responsive grids. Use the installed shadcn primitives in `src/components/ui/` for their matching controls and semantic color tokens from `src/styles.css`; keep app-specific layouts in the routes. Use skeletons in `src/components/loading.tsx` for initial loading and preserve loaded content during polling. Retain explicit empty, error, review, and disabled states. Keep keyboard focus and semantic controls usable.

For visual changes, inspect the running application in the collaborative browser at desktop and phone widths. In VibePod, check `vibepod-preview list` and reuse `asset-studio`; use `vibepod-preview restart asset-studio` if stopped. Create a missing preview through `vibepod-preview run`, using `asset-studio` as its stable name and matching Vite's port to the managed preview port. Run `vibepod-preview doctor asset-studio` before reporting it healthy.

## Verification

Use the scripts in `package.json`:

```sh
bun run typecheck
bun run test
bun run build
bun run eve:typecheck
# The four checks above together:
bun run verify
```

For database/API or recovery changes, also run the relevant integration tests with a configured local PostgreSQL database, for example `TEST_DATABASE=1 bun test src/lib/api.integration.test.ts`. Read the integration test's setup before execution. Rebuild Eve with `bun run eve:build` when its configuration or shared instructions change. Documentation-only edits need content/link checks and `git diff --check`; do not run paid generation solely to validate prose.

## Local services and data

Use Docker Compose for PostgreSQL. In the existing VibePod environment, `docker compose -p studio up -d --wait` reuses the established database volume. Inspect existing services before launching another supervisor; `scripts/services.sh` runs Eve, Blender MCP, and the worker. Runtime logs are in `data/logs/`.

Keep `.env`, credentials, `data/`, Eve session storage, and generated assets out of commits. Retain PostgreSQL and file storage together for recovery; never delete volumes or real projects as cleanup. This app is a trusted local workshop, and generated Blender Python executes with the service user's permissions. Keep backend services on loopback and do not expose them as a public multi-tenant service without a separate security design.

## AI module boundaries

Use `src/modules/ai/index.server.ts` (`runRole`, `roleInput`) for all AI work. Role definitions live in `src/modules/ai/roles.ts`; callers must not import adapter internals. `src/modules/pipelines/index.ts` defines provider-independent pipeline traversal and the model review sequence. Asset-specific handlers remain in `src/lib/pipeline.server.ts`. See [AI architecture](docs/ai-architecture.md) for extension, recovery and accounting contracts.
