# Development and operations

Use the [README](../README.md#run-locally) for installation. This application runs one web process, one worker, one Eve process, and one loopback Blender service against PostgreSQL. It is intended for a single owner. The web UI and ordinary API require an authenticated reverse proxy when exposed outside your machine. MCP has its own OAuth authentication.

## Source map

| Location | Responsibility |
|---|---|
| `src/routes/` | File routes and route-specific components |
| `src/components/` | Shared interface controls and model/material viewers |
| `src/lib/api.server.ts` | Project, design, generation, and asset HTTP operations |
| `src/lib/admin.server.ts` | Queue, role settings, runtime settings, and diagnostics |
| `src/lib/workshop.server.ts`, `src/lib/materials.server.ts` | Imports, source bundles, material generation, and assignment |
| `src/modules/mcp/` | MCP tools, resources, artifact access, and OAuth |
| `src/modules/ai/` | Typed role execution, providers, usage, and pricing |
| `src/modules/pipelines/` | Versioned workflow graphs and traversal |
| `src/lib/pipeline.server.ts`, `src/lib/model-pipeline.server.ts` | Job coordination and model-specific artifacts |
| `src/lib/checkpoint.server.ts`, `src/lib/recovery.ts`, `src/lib/legacy-recovery.server.ts` | Durable identity and recovery |
| `scripts/worker.ts` | PostgreSQL job claiming and worker lifecycle |
| `src/db/`, `drizzle/` | Database schema and migrations |
| `eve/agent/`, `blender/` | Agent tools, capability-scoped workspaces, and isolated Blender execution |
| `prompts/` | Authored instructions and input templates |

Keep credentials, filesystem access, database calls, and agent execution in server modules. Use `src/modules/ai/index.server.ts` for AI calls. Do not import provider adapters directly. Do not hand-edit `src/routeTree.gen.ts` or build output.

## Runtime services

`bun run services` supervises Eve, Blender MCP, and the worker. It loads `.env`, writes logs to `data/logs/`, waits for Eve readiness, and stops its children on termination. It launches Eve with Bun so authored TypeScript tools use the same runtime as the app. Do not run a second supervisor against the same database.

If startup fails, inspect `data/logs/eve.log` and `data/logs/blender-mcp.log`. Confirm PostgreSQL is healthy with `docker compose -p studio ps`. Check that the app, worker, and Eve share `EVE_PASSWORD`, storage settings, and provider credentials. The Eve secret must contain at least 32 random characters. The shared system prompt or Eve channel configuration requires `bun run eve:build` followed by a service restart.

The web production build is `.output/server/index.mjs`. Run it with `PORT=3000 bun .output/server/index.mjs`. Bind internal services to loopback. Blender scripts run with the service user's permissions; generated code is not an operating-system sandbox.

In VibePod, reuse the registered `asset-studio` preview. Run `vibepod-preview list` before starting a server, use `vibepod-preview run asset-studio -- bun .output/server/index.mjs` when it is missing, and run `vibepod-preview doctor asset-studio` before reporting it healthy. The managed preview supplies its port and public URL.

## Persistence and migrations

PostgreSQL holds projects, immutable revisions, attempts, jobs, checkpoints, OAuth records, and usage history. `data/` holds assets, workspace scripts, receipts, runtime settings, and logs. Eve retains sessions in `eve/.eve/`. Back up database and file/session storage together while services are stopped or through a coordinated snapshot.

`STUDIO_DATA_DIR` changes the local asset directory. Pass the same value to every process. S3 can store media, but Blender workspaces and recovery still require local storage. Do not remove `data/`, Eve sessions, or the PostgreSQL storage during cache cleanup.

For schema changes, run `bun run db:generate`, inspect the generated SQL, then run `bun run db:migrate`. Never generate or apply a migration merely to format existing files. Keep old pipeline definitions available for saved jobs.

## Verification

```sh
bun run verify
bun run eve:build
bun audit
.venv/bin/python -m pip install -r scripts/requirements-dev.txt
.venv/bin/ruff check blender scripts
```

The main gate checks TypeScript, unit tests, tracked-file hygiene, relative Markdown links, the web build, and Eve types. The Eve build also evaluates authored modules. The Python lint catches undefined names and unused imports, including the fixed globals supplied by the Blender runner. No check above needs a paid generation request.

Run database tests against a dedicated, migrated database with no worker. Override `DATABASE_URL` and `STUDIO_DATA_DIR` in your shell, then run:

```sh
bun run db:migrate
TEST_DATABASE=1 TEST_REFERENCE_DATABASE=1 bun test src
```

These tests create and delete fixtures and replay saved provider responses. Do not point them at your workshop database. S3 integration tests require their own test bucket and explicit opt-in.

Run Python checks from the repository root. `PYTHONPATH` allows the standalone mesh-analysis modules to import each other:

```sh
PYTHONPATH=blender .venv/bin/python -m unittest \
  blender.test_analyze_mesh blender.test_analysis_blender \
  blender.test_materials blender.test_material_quality \
  blender.test_build_artifacts blender.test_workspace \
  blender.test_build_runtime blender.test_build_workflow \
  blender.test_cancellation scripts.test_provider
```

Set `BLENDER_BIN` in the shell to enable real Blender analysis and source-rebuild tests. These use temporary directories and may take several minutes. The sprite, geometry, and assignment checks run inside Blender itself:

```sh
blender -b --factory-startup --threads 2 --python-exit-code 1 \
  --python blender/test_assetkit_shapes.py \
  --python blender/test_assignment.py \
  --python blender/test_sprite_render.py
```

The CI workflow uses an isolated PostgreSQL service, mocked AI responses, Python lint/unit checks, and both builds. It does not call paid providers. Real Blender rendering and optional S3 checks remain local verification steps.

## Repository contents

Keep `.env`, credentials, generated assets, evaluation output, build output, Python environments, dependency caches, logs, and local agent state out of Git. Commit authored source, tests, prompts, migrations, dependency lockfiles, and current product artwork. The tracked-file test guards this boundary; a secret scanner must also inspect content and history before publication.
