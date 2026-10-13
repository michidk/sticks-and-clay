# Sticks & Clay

Sticks & Clay is a local workshop for cohesive 3D assets, graphics, procedural PBR materials, and sprites rendered from 3D. Approve a collection's design, generate assets, inspect their renders and history, then download models and reproducible source bundles. Agents can use the same workshop through an OAuth-protected HTTP MCP server.

3D builders write editable Python scripts and run isolated Blender processes. Graphics use an OpenAI-compatible Image API. The app records model usage and estimated costs, including failed attempts. Generation uses paid providers; procedural material recipes and exports run locally.

The application uses Bun, React 19, TanStack Start, Tailwind, Drizzle/PostgreSQL, Eve, and Blender. It is a single-owner workshop. Keep the web UI behind authentication when deployed, and keep Eve and Blender services on loopback. Generated scripts execute with the service user's filesystem permissions.

## Run locally

On Linux, macOS, or WSL, install Bun 1.4+, Node 24+, Python 3.11+, Blender 4.5 LTS, and Docker. The lockfile pins JavaScript dependencies; Python dependencies are pinned in `blender/requirements.txt`.

```sh
bun install --frozen-lockfile
cp .env.example .env
python3 -m venv .venv
.venv/bin/python -m pip install -r blender/requirements.txt
```

Edit `.env` privately. Set `EVE_PASSWORD` to a random secret of at least 32 characters. Set `OPENAI_API_KEY` and `OPENAI_BASE_URL` for your provider, or use an existing Codex provider configuration. The app, worker, and Eve must use the same credentials and storage settings. Set `BLENDER_BIN` if Blender is outside your `PATH`.

Start PostgreSQL and apply the migrations:

```sh
docker compose -p studio up -d --wait
bun run db:migrate
bun run services
```

Leave the service supervisor running. In another terminal, start the web app:

```sh
bun run dev --port 3000
```

Open `http://localhost:3000`. Eve listens on `127.0.0.1:33441`, Blender MCP on `127.0.0.1:33442`, and PostgreSQL on `127.0.0.1:55439`. The supervisor also starts the durable worker. For a production web build, run `bun run build`, then `PORT=3000 bun .output/server/index.mjs`; keep the background services running separately.

On Windows, use WSL for the service launcher. See [development and operations](docs/development.md) for service troubleshooting, storage, and verification.

## Create a collection

1. Choose 3D assets or graphics. Enter a name, an optional brief, and up to six reference images. AI can draft the name and brief.
2. Review the generated design. Edit it directly or use Design chat to request changes. AI revisions appear in the queue and need approval before generating assets.
3. Optionally generate 1–4 concept mockups through the ChatGPT Image API to preview the approved direction. Skip this step to go straight to generation. Mockups retain their design version and do not alter the approved design or uploaded references.
4. Add model or graphic ideas using the brief dialog, with 1–20 deliverables per idea. Start generation right away, or save the idea for later; saved ideas wait at the top of the Models or Graphics tab with Start, Edit and Discard actions. Starting uses the currently approved design; each batch snapshots that design and collection guidance.
5. Inspect generated assets, technical checks, archived versions, transcripts, and costs. Models support refinement, forks, material assignment, new renders, and sprite exports.
6. Download GLB/Blender files, images, or source bundles. Source bundles include pinned helpers and rebuild without an agent or database.

New 3D jobs retain blockout, shape refinement, materials, and polish passes. Zero review rounds disables judging while retaining those passes and photography. With judging enabled, geometry must pass before material work. Exhausted reviews finish with issues; technical failures remain separately recoverable. Graphics use a one-shot image request and skip Blender and 3D judging.

## Connect an agent

Configure a remote HTTP MCP connection to your workshop's `/api/mcp` URL. The server exposes 38 tools with separate read, write, and administration permissions. OAuth consent approves access; clients store and refresh their credentials. No companion skill is required.

See [MCP setup for Codex and Claude](docs/mcp.md) for commands, owner configuration, and artifact access.

## Verify changes

```sh
bun run verify
```

This checks application and Eve types, unit tests, repository-file hygiene, documentation links, and the production build. Database tests require a separate migrated PostgreSQL database with no worker. Python and real Blender checks run separately; see [verification commands](docs/development.md#verification).

## Documentation

- [Asset workshop](docs/asset-workshop.md): materials, sprites, imports, collection style, and source bundles.
- [Quality pipeline](docs/quality-pipeline.md): required modeling passes, reviews, and recovery.
- [AI architecture](docs/ai-architecture.md): roles, providers, accounting, and durable execution.
- [Model processing](docs/model-processing.md): GLB export cleanup and technical analysis.
- [Model viewer](docs/model-viewer.md): camera modes, screenshots, and component options.
- [Prompt guide](prompts/README.md): authored instructions and third-party attribution.
- [Design guide](design.md): interface theme and component conventions.
- [Development and operations](docs/development.md): source map, service setup, persistence, and tests.

PostgreSQL, `data/`, and Eve session storage form one recoverable state. Back them up together. Build output, generated assets, credentials, local tool state, and evaluation results are excluded from the repository.

## License

Sticks & Clay is licensed under the [MIT License](LICENSE). Third-party prompt references retain their [attribution and license notices](prompts/references/SOURCES.md).
