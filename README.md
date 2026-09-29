# Sticks & Clay

A working game-asset pipeline application, built alongside CodeTend with the same core stack: **Bun, React 19, TanStack Start/Router, Vite, Tailwind 4, Drizzle/PostgreSQL, and Eve**. React Three Fiber provides the interactive GLB viewer; Blender runs locally through an isolated MCP adapter.

The interface uses locally owned [shadcn components](https://ui.shadcn.com/) and a custom ivory, forest-green, and sage theme in `src/styles.css`. Configure/add primitives through `components.json` and keep app-specific layout in the routes. Skeletons cover initial page, image, and viewer loading; polling retains already loaded content.

## Project documentation

- [Design guide](design.md): the current ivory, forest-green, and sage UI theme, typography, components, and responsive behavior.
- [Agent instructions](AGENTS.md): code boundaries, workflow invariants, development checks, and local service conventions.
- [Prompt guide](prompts/README.md): authored agent instructions and input templates.
- [Quality pipeline](docs/quality-pipeline.md): visual targets, geometry gates and recovery.

The application design guide describes Sticks & Clay itself. Each asset project's design reference is a separate, editable and versioned document in the database.

## Workflow

1. Start a project with a name and a brief, plus up to six optional reference images. Use AI generate brief to fill the field, then edit it before continuing. Leaving it empty does not generate implicitly.
2. A TanStack AI background call inspects the images and writes a Markdown design reference. The database stores the document and revisions. Edit it, then save and approve it. GFM rendering supports tables, task lists and strikethrough. Immutable database revisions are compared using the `diff` library; Restore as draft loads an older version into the editor, and Save creates a new revision without overwriting history.
3. Request a concrete model or ask the planner to propose a set. Choose 1–20 models and 0–5 maximum judge rounds. A batch snapshots the approved design; later edits cannot change its contract.
4. A PostgreSQL job queue dispatches model attempts, with two concurrent workers by default. Each first generates an imagegen visual target from the approved design, model brief and references. The target is its thumbnail until a 3D render exists and remains available in the Visual target tab. Each build iteration has an isolated Blender directory and process.
5. With judging enabled, the builder first develops geometry with temporary matte materials, exports GLB/source/metrics and three views, and inspects them through `view_render`. A dedicated photographer imports the archived GLB into a clean studio, renders and inspects three views, and supplies those exact images to the geometry judge and gallery. Geometry must pass before final texture/material work begins.
6. Each geometry or surface review receives actual renders, the visual target, user references, design, brief and metrics. Concrete prioritized corrections go to a fresh builder with the preceding source while that stage has rounds remaining. Texture requests and image targets have separate history, token usage and cost records.
7. Passing assets finish early. At the review limit, remaining issues stay visible as **completed with issues**, not an approval. Zero rounds means one build plus photography with no judge. Technical failures are separate and can be retried; every attempt remains in history.
8. Final material exports render in a scale lineup and staged collection demo, with a downloadable scene. Geometry-only previews are excluded. The web app provides orbit/zoom previews, product renders, GLB/source downloads, design history, agent transcripts, and usage/cost breakdowns.

Progress represents workflow milestones, not a predicted wall-clock percentage. New attempts apply the round limit per stage: two permits up to two geometry build/review pairs, then up to two surface pairs. Early passes skip unused rounds; geometry exhaustion withholds surface work. New v3 attempts run builder → photographer → judge at each stage. Existing v1/v2 attempts retain their original pipeline on resume. Resume reuses Eve sessions and completed step checkpoints. Every builder iteration retains an archived export and its judge feedback; collection thumbnails use only the latest version.

## Run locally

Requirements: Bun, Node 24+, Python 3.11+, Blender on PATH, and Docker for PostgreSQL.

Before starting services, copy `.env.example` to `.env` and configure the database and model provider privately. On machines without Codex provider configuration, set `OPENAI_API_KEY` and `OPENAI_BASE_URL` in the service environment. Review the model and estimated pricing settings for your provider.

```sh
bun install
docker compose -p studio up -d --wait
bun run db:migrate
python3 -m venv .venv
.venv/bin/python -m pip install -r blender/requirements.txt
(cd eve && ../node_modules/.bin/eve build)
bash scripts/services.sh
```

The services script runs Eve (loopback port 33441), Blender MCP (33442), and the durable job worker. In another terminal, start the app:

```sh
bun run dev --port 3000
```

In VibePod, reuse the `asset-studio` managed preview. The existing PostgreSQL Compose project is named `studio` because it was started before this directory was moved; use `-p studio` to reuse its persistent volume. The background service group runs in tmux as `asset-studio-services`:

```sh
tmux attach -t asset-studio-services
vibepod-preview logs asset-studio
vibepod-preview doctor asset-studio
```

Copy `.env.example` to `.env` if needed. The service supervisor loads `.env` once and passes the same settings to every child; Bun also reads `.env` for the app. `scripts/provider.py` passes credentials only to the configured provider and never prints or saves them. On a machine without Codex configuration, provide `OPENAI_API_KEY` and `OPENAI_BASE_URL` directly. For production builds, use `bun run build` and `bun .output/server/index.mjs` with `PORT` set.

## Architecture and persistence

- `src/routes/`: project list, project workspace, colocated history components, and API route.
- `src/components/model-viewer/`: reusable React Three Fiber GLB lightbox and scene controls.

`ModelViewer` accepts an optional GLB `src` (omit it to show sample cubes), `height`, and `alt`. Scene defaults can be set with `lighting="day" | "night"`, `showGround`, `showGrid`, and `showCubes`; interaction defaults use `mode="orbit" | "object" | "firstPerson"`, `autoRotate`, and `autoRotateSpeed`. `showOrientation` controls the view cube, while `showUi={false}` removes the toolbar and hints for compact previews. `onLoad`, `onError`, `onModeChange`, and `onLightingChange` expose viewer events. The built-in toolbar changes scene options locally, so a parent that needs synchronized state should use the callbacks. First-person mode uses pointer lock when permitted: click the scene, move with WASD or arrow keys, and press Escape to release. In embedded frames that disallow pointer lock, drag on the focused canvas to look around and use the same movement keys. Import the viewer lazily on pages that do not always show a model. The workspace uses it on the dedicated model detail page and as an opt-in, UI-free quick preview on model cards; static renders remain the default so a large collection does not create many WebGL contexts.

The full viewer's camera menu captures the current scene as a PNG. **Copy image** puts the PNG on the system clipboard for pasting into another app; **Download PNG** saves the same scene with a model-based filename. Browser clipboard permissions may prevent copying, in which case the viewer reports the error and downloading remains available. UI-free card previews do not show screenshot actions.
- `src/lib/api.server.ts`: validated project/design/generation endpoints, uploads and downloads.
- `src/lib/pipeline.server.ts`: designer → planner → builder/judge → collection workflow.
- `src/modules/ai/internal/eve.server.ts`: fresh Eve sessions, structured output validation, event persistence and token accounting.
- `src/modules/ai/internal/tanstack.server.ts`: structured brief/design calls through TanStack AI, with persisted run results and usage estimates.
- `scripts/worker.ts`: PostgreSQL job claiming (`SKIP LOCKED`), bounded concurrency, coordinator lock and restart recovery.
- `src/db/schema.ts`, `drizzle/`: projects, immutable design revisions, batches, models, agent runs, events and jobs.
- `eve/agent/`: model configuration, authenticated local channel, Blender MCP connection and authored vision tool.
- `blender/`: isolated MCP service, export/render helpers and collection renderer.
- `prompts/`: all system prompts, role prompts and input templates. Eve loads its shared instructions from this folder at build time.
- `data/`: immutable upload keys, per-attempt/per-iteration assets, collection renders, runtime logs and temporary build capabilities. Back up this directory together with PostgreSQL.

The worker re-adopts interrupted jobs on restart. Per-job database checkpoints retain Eve run/session IDs and completed step results. Recovery replays the durable Eve stream and reattaches to active work; explicit Resume continues failed turns in the same conversation. Builder workspaces and scoped capabilities survive recovery. Completed design/planner transactions are checkpointed atomically to prevent duplicate revisions or model batches. Token totals are reconstructed from session events with idempotent event storage, rather than added again on replay. Eve session storage and the data directory must be retained; missing/retired sessions and operator approval requests report errors rather than silently starting over. External Blender execution may be retried following an interruption, so scripts should be idempotent. It is a trusted local workshop, not a multi-tenant service: there is no end-user account system, and generated Blender Python runs with the service user's filesystem permissions. MCP and Eve bind to loopback. Put authentication and stronger execution isolation in front of an external deployment.

## Image transport lessons

Eve 0.63 accepts user images as **file parts with an image media type**, despite protocol types also mentioning image parts. The app sends data URLs in file parts. For tool images, use `toolOutput.content` + `toolOutputPart.file` in `view_render`. Raw MCP image blocks were serialized as text by this integration, inflating usage and exhausting context; they are blocked from the model-facing MCP tools. A regression test covers the vision output shape. `view_render` persists a small immutable image reference and loads its pixels only when assembling model input; this avoids counting base64 payloads as text during Eve context estimation. Older inline-image session records remain supported.

The configured gateway cannot retrieve non-persisted Responses item IDs. Eve explicitly uses `store: false`, so local assistant messages and paired function calls are serialized in full; reasoning history is omitted. Graceful shutdown requeues interrupted jobs with their checkpoints. The single-process local service uses a 60-second recovery lease instead of the SDK's 860-second default. New sessions do not expire automatically; per-request timeouts remain bounded.

## Asset contract

Every build has a ground-centered origin, meters, an individual GLB and `.blend`, named materials, reported triangle counts, and three consistent product renders. Textured mode validates embedded base-color and tangent-space normal maps on exported materials. Explicit poly mode rejects image textures. Triangle limits are optional: project setup has a blank-by-default budget field. Without an explicit limit the designer adds no numeric targets and the exporter imposes no default cap. An explicit design budget is passed to the helper and checked by the judge. Architectural openings, material scale, believable silhouettes, and the earlier bark texture lessons are in the prompts.

This version produces the primary asset and presentation scene. Engine-specific collision generation, LOD chains, animation, and exact modular assembly validation are future extensions. The collection demo is a staged presentation at shared scale, not automatic semantic level assembly.

## Token accounting and cost

Each run stores the role, prompt content/hash, concrete input, image keys, structured/text output, events including tool calls, model/session IDs, timestamps, input/output/cache tokens, usage source, and a pricing snapshot. Project totals include setup/planning and failed attempts. Model totals include all its build/judge attempts. Individual iterations are expandable in **Activity & cost**.

Provider `costUsd` is not used. Estimates are calculated as:

```
((input - cache_read) × input_rate + cache_read × cached_rate + output × output_rate) / 1,000,000
```

Configured default assumptions are $2/M input, $0.20/M cached input and $10/M output for the configured GPT-6 Sol model. Verify/set current rates when selecting a model; these are estimates, not invoiced charges. Stored rates preserve reproducibility when configuration changes later.

If step usage is absent/zero, the adapter estimates text at four characters per token, adds 1,000 tokens per image per step, and approximates tool context. Records distinguish reported, estimated, mixed, pending and not-started usage. Hidden reasoning and image tokenization can differ from these assumptions. A rejected request before model execution has zero model tokens. Local Blender CPU time has no model-token charge; elapsed run time is recorded separately. Imagegen requests store reported image API tokens; cost remains unavailable unless image-token pricing is configured.

## Verification

`bun run verify` runs application type checking, tests, the production build, and Eve type checking. Database integration and Eve build checks can also be run explicitly:

```sh
bun run typecheck
bun run test
TEST_DATABASE=1 bun test src/lib/api.integration.test.ts
bun run build
(cd eve && ../node_modules/.bin/eve build)
```

The database integration tests create and remove only their own fixtures. They cover approval gates, stale-design edit rejection, revision persistence, input limits, and proxy-origin handling. Contract tests cover pricing/cache calculations, review termination and output validation; vision tests cover file-part image transport. Live validation uses the clearly named Stonehaven pipeline test project so real failures, retries, renders, judges and token costs can be inspected.

### Live validation — 2026-09-29

The Stonehaven test exercised an uploaded reference, generated design, browser approval, a two-model plan, concurrent Blender builds, independent vision judges, feedback-driven rebuilding, early approval, and the review limit. Marker B passed at 86/100 (1,496 triangles); marker A finished with issues at 79/100 after two review rounds (1,396 triangles). Both have embedded color/normal textures, source files, product renders, and working GLB downloads. Desktop and phone previews were inspected in the shared T3 browser.

The retained history reports 822,705 input and 31,032 output tokens, with a **$1.7078 estimated model cost** using the snapshotted rates and cache discount. This includes failed integration attempts and the original raw-image transport defect; it is a debugging total, not an estimate of normal per-asset cost. The corrected vision path and its regression test are included.


## Direct AI and queue controls

Project/model brief buttons call TanStack AI directly. They create no Eve session and no queue job. Their inputs, outputs, token usage, cached tokens, pricing snapshot, and cost estimate are saved in project history. Design generation is a durable background job using TanStack AI; interruption retries a direct call, while a completed response checkpoint is reused. An interrupted direct request may have unknown usage until the provider reports it.

The header Queue link opens `/admin/queue`. It lists model generation, planning and collection-render jobs, with per-job cancellation and Abort pending queue. Running cancellations are cooperative: the UI shows Cancelling until the worker stops. Cancelled jobs are not resumed automatically. Model iteration history lives in each model viewer; previous GLBs, Blender files, renders and judge reviews stay accessible.

## AI module boundaries

Use `src/modules/ai/index.server.ts` (`runRole`, `roleInput`) for all AI work. Role definitions live in `src/modules/ai/roles.ts`; callers must not import adapter internals. `src/modules/pipelines/index.ts` defines provider-independent pipeline traversal and the model review sequence. Asset-specific handlers remain in `src/lib/pipeline.server.ts`. See [AI architecture](docs/ai-architecture.md) for extension, recovery and accounting contracts.

## Role settings and generated textures

`/admin/agents` displays code-configured roles, engines, model IDs, effort levels and prompt paths. Edit `src/modules/ai/roles.ts` to change settings for new requests. Builder, photographer and judge use `gpt-6-astra`, medium effort; other roles use `gpt-6-sol`, medium effort. Eve reads a saved `data/session-config/<sessionId>.json` model/effort snapshot before each model step. Keep these files with the database and Eve storage. Rebuild/restart Eve when its tool or model adapter changes.

Astra estimates use [documented standard token rates](https://developers.openai.com/api/docs/models/gpt-6-astra): $10/M input, $1/M cached input, $50/M output, with the long-context multiplier evaluated per model call. These remain estimates rather than invoices. Other model rates use the existing operator configuration.

The builder-only `generate_texture` tool calls `/api/textures/generate` with its workspace capability. The server invokes the installed Codex imagegen skill CLI unchanged through `scripts/imagegen_texture.py`, which captures SDK usage for the audit history. No Codex conversational session is spawned. Generated base colors must be wired into UV-mapped materials; matching normal maps remain part of the asset contract. Poly mode skips texture generation; it still gets a concept target.

Imagegen prerequisites (outside the app dependency environment):

```sh
python3 -m venv /tmp/asset-studio-imagegen
/tmp/asset-studio-imagegen/bin/pip install openai pillow
```

Set `STUDIO_IMAGEGEN_PYTHON` if using another isolated environment, `STUDIO_IMAGEGEN_SKILL` if the installed skill is elsewhere, and `STUDIO_APP_URL` to the app's loopback URL/port for Eve's tool. The default installation uses port 34193. Recreate the temporary environment if it is cleared. Credentials are resolved by `scripts/provider.py` and never stored with artifacts.

Image generation logs inputs, output paths, status and raw reported token usage separately in Activity & cost. Set both `IMAGE_INPUT_USD_PER_MILLION` and `IMAGE_OUTPUT_USD_PER_MILLION` for an operator-assumed image-token estimate. Without those rates, cost is explicitly unavailable; it is not treated as a free request. Provider cost fields are ignored. An interrupted image request can incur unknown usage; retrying can create another charge. Successful identical texture requests reuse their saved receipt.

The model viewer's **Textures** tab shows generated/source PNGs and the actual embedded GLB textures for the selected iteration. Existing archives without a texture manifest show an explicit empty state. Model thumbnails still use only the latest renders.

## Reference images and media storage

The project dialog uses a Roastbook-style image picker: choose files, drag and drop, paste a copied image while the picker is focused, or expand **From URL** and paste a direct image link. Pasting a URL onto the picker opens the URL field. Thumbnails can be removed individually. PNG, JPG and WebP are supported, with a maximum of six references and 8 MB per image. URL imports validate public HTTP(S) destinations on every redirect, pin DNS addresses, enforce a download deadline and byte limit, and verify image signatures. They remain temporary browser selections until the brief or project is saved.

Reopening a draft displays its saved references. Generating a brief saves the selected references; subsequent requests reuse their keys. Removing every thumbnail explicitly clears a draft's references when it is next saved. Removed persisted files are retained because earlier AI runs can still refer to them.

`src/lib/storage/` adopts Roastbook's `StorageProvider` interface: upload, download, delete, getUrl, exists, list and listObjects. The local provider is the default and preserves existing `data/` keys. Set `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` to use S3; `S3_ENDPOINT` enables a custom S3-compatible endpoint with path-style addressing. Apply the same settings to the app and worker, then restart both.

New reference images and completed version/collection outputs use the configured provider. File serving and AI image transport read through that layer; private bucket objects are served by the app's existing `/api/files/` URLs. Existing local files remain readable when S3 returns “not found”; switching providers does not migrate or delete data. Blender working files, generated visual targets, Eve sessions, checkpoints and local archives still require `STUDIO_DATA_DIR`. S3 is media storage, not a replacement for backing up PostgreSQL and the local working directory.

Storage unit tests run with `bun run test`. S3 integration tests require an isolated endpoint and `TEST_S3_ENDPOINT`, `TEST_S3_ACCESS_KEY_ID`, and `TEST_S3_SECRET_ACCESS_KEY`; the test creates a unique bucket. Reference submission integration tests require `TEST_REFERENCE_DATABASE=1` and a migrated, isolated `DATABASE_URL` with **no worker attached**, because the test creates and removes its own queued design job. No paid generation is needed.

## Project thumbnails

After each generation batch settles, a queued photographer session renders all latest published project models together, across batches. The newest completed photo becomes the project card's thumbnail; the reference image is the fallback. Geometry previews can be included before final materials exist. Photo history, source versions, token usage and estimates remain in Activity & cost. Queue shows project photography progress, cancellation and Resume for failures. Existing projects can refresh with `POST /api/projects/<id>/photograph`.
