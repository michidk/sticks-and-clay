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

`bun run services` builds Eve and provisions its sandbox templates before starting Eve, Blender MCP, and the worker. It loads `.env`, writes service logs to `data/logs/`, waits for Eve readiness, and stops its children on termination. A failed build prevents the worker from claiming jobs. It launches Eve with Bun so authored TypeScript tools use the same runtime as the app. Do not run a second supervisor against the same database.

If startup fails, inspect the supervisor output, `data/logs/eve.log`, and `data/logs/blender-mcp.log`. Confirm PostgreSQL is healthy with `docker compose -p studio ps`. Check that the app, worker, and Eve share `EVE_PASSWORD`, storage settings, and provider credentials. The Eve secret must contain at least 32 random characters. Restart the supervisor after changing shared instructions or Eve configuration; startup rebuilds them.

After Docker state loss, restart the supervisor to restore sandbox templates, then resume failed jobs. Unusable Eve workflows and sessions whose sandbox containers were lost get new runs for the interrupted role. Failed runs, their usage, completed pipeline checkpoints, and archived assets remain in history. Ordinary turn failures continue their existing sessions.

Photography applies the configured Blender execution budget to each of its three or seven full-quality views. Its agent deadline includes the seven-view render budget plus the configured agent time for camera selection and inspection. Render-slot waiting counts toward the execution budget, and cancellation still stops the owned process tree.

The web production build is `.output/server/index.mjs`. Run it with `PORT=3000 bun .output/server/index.mjs`. Bind internal services to loopback. Blender scripts run with the service user's permissions; generated code is not an operating-system sandbox.

In VibePod, reuse the registered `asset-studio` preview. Its managed command must start PostgreSQL and the backend services as well as the web server. VibePod restores that command after pod replacement; Docker containers and separate tmux sessions do not survive, even though the workspace and database files do.

After building the web app, stop any separately launched `bun run services` supervisor, then register the complete startup command:

```sh
vibepod-preview list
# Stop an existing web-only preview before replacing its command.
vibepod-preview stop asset-studio
vibepod-preview run --ready-timeout 5m asset-studio -- bash scripts/services.sh --preview bun .output/server/index.mjs
vibepod-preview doctor asset-studio
```

The managed preview supplies its port and public URL. `--preview` re-creates the local Compose database container using `data/postgres/`, waits for database readiness, provisions Eve, starts the backend services, and then starts the web command. It leaves PostgreSQL data intact when stopped and terminates the web process and backend services together. The web log is `data/logs/web.log`; startup failures appear in `vibepod-preview logs asset-studio`. Use an absolute path to an isolated build's `server/index.mjs` when other tasks may rebuild `.output` concurrently. Subsequent starts use `vibepod-preview restart asset-studio`.

## Container deployment

`docker build -t sticks-and-clay .` builds the Linux x64 runtime with Bun, Node, Python dependencies, and checksum-verified Blender 4.5.4. The build context excludes local credentials, assets, Eve sessions, and tool state. `scripts/services.sh --production` applies migrations to `DATABASE_URL`, builds the bundled Eve agent, then supervises Blender, Eve, the worker, and the web server. Service output goes to container logs. Kubernetes restarts the container if a supervised service exits.

Mount persistent volumes at `/home/vibepod/workspaces/sticks-and-clay/data` plus the `.workflow-data` and `sandbox-cache` subdirectories of `/home/vibepod/workspaces/sticks-and-clay/eve/.eve`. Keep `.eve/builds` and `eve/.output` on the container filesystem so Eve can rename its compiled output atomically. Use UID/GID 1000. Keeping the original workspace path preserves saved Blender scripts and Eve checkpoint paths. PostgreSQL runs separately with its own persistent volume. Pass provider credentials directly through environment variables. The Eve sandbox uses `just-bash`; native Blender execution stays in the capability-scoped service and requires no Docker daemon.

The image workflow publishes commit-tagged images to `ghcr.io/michidk/sticks-and-clay`. Deploy the resulting digest through the infrastructure repository. The permanent cluster manifests, authentication boundary, migration, and recovery procedures are owned by `michidk/k8s` under `apps/sticks-and-clay/` and `docs/sticks-and-clay.md`.

## Persistence and migrations

PostgreSQL holds projects, immutable revisions, attempts, jobs, checkpoints, OAuth records, and usage history. `data/` holds assets, workspace scripts, receipts, runtime settings, and logs. Eve retains sessions in `eve/.eve/`. Back up database and file/session storage together while services are stopped or through a coordinated snapshot.

`STUDIO_DATA_DIR` changes the local asset directory. Pass the same value to every process. S3 can store media, but Blender workspaces and recovery still require local storage. Do not remove `data/`, Eve sessions, or the PostgreSQL storage during cache cleanup.

For schema changes, run `bun run db:generate`, inspect the generated SQL, then run `bun run db:migrate`. Never generate or apply a migration merely to format existing files. Keep old pipeline definitions available for saved jobs.

## Verification

```sh
bun run verify
bun run eve:build
bun run audit
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
  blender.test_cancellation scripts.test_provider scripts.test_services
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

### Dependency audit exception

`bun run audit` ignores only `GHSA-hp3w-g68c-fv3c`, the unbounded floating-point
precision advisory in `sprintf-js`, which has no patched release. The pinned
`just-bash` 3.6.0 dependency validates precision before calling that formatter.
`src/lib/sandbox.test.ts` sends the advisory's oversized precision inputs through
the real shell and checks that it rejects them while the next command still
works. The app also disables Eve's default shell tools. Remove this exception
when the dependency publishes a fix or drops the affected package. Other
advisories still fail CI.

`guarded-fetch` pins an affected Undici release; the dependency override replaces
only `undici@7.29.0` with patched 7.30.0, leaving Eve's separate Undici 8 dependency
on its supported major version.
