# Sticks & Clay

A visual asset studio for cohesive **3D asset and graphic collections**, built alongside CodeTend with the same core stack: **Bun, React 19, TanStack Start/Router, Vite, Tailwind 4, Drizzle/PostgreSQL, and Eve**. React Three Fiber provides the interactive GLB viewer; builders author saved Python scripts through native Eve tools and run isolated Blender processes; graphic agents use the Codex-configured OpenAI-compatible Image API. The independent photographer and historical builder sessions retain Blender MCP.

The interface uses locally owned [shadcn components](https://ui.shadcn.com/) and a custom ivory, forest-green, and sage theme in `src/styles.css`. Configure/add primitives through `components.json` and keep app-specific layout in the routes. Skeletons cover initial page, image, and viewer loading; polling retains already loaded content.

## Project documentation

- [Design guide](design.md): the current ivory, forest-green, and sage UI theme, typography, components, and responsive behavior.
- [Agent instructions](AGENTS.md): code boundaries, workflow invariants, development checks, and local service conventions.
- [Prompt guide](prompts/README.md): authored agent instructions and input templates.
- [Quality pipeline](docs/quality-pipeline.md): visual targets, geometry gates and recovery.
- [Asset workshop](docs/asset-workshop.md): reusable construction helpers, collection memory, source bundles, imports, PBR materials and 3D sprite exports.

The application design guide describes Sticks & Clay itself. Each asset project's design reference is a separate, editable and versioned document in the database.

## Workflow

1. Start a project by choosing **3D assets** or **Graphics**, then add a name, optional brief, and up to six optional reference images. Generate or enhance the brief using AI, then edit it before continuing. A blank brief proceeds directly to design generation using the name and references.
2. A type-specific TanStack AI background call inspects the inputs and writes a Markdown design reference: construction and material rules for 3D, or composition and visual-system rules for graphics. The database stores immutable revisions. Edit, save, and approve the direction before generation.
3. Optionally request concrete deliverables, or leave the brief blank so the matching planner proposes a set from the approved design and references. Choose 1–20 items. Every batch snapshots the approved design; later edits cannot change its contract.
4. A PostgreSQL job queue dispatches model attempts, with two concurrent workers by default. Each first generates an imagegen visual target from the approved design, model brief and references. The target is its thumbnail until a 3D render exists and remains available in the Visual target tab. Each build iteration has an isolated Blender directory and process.
5. With judging enabled, the builder first develops geometry with temporary matte materials, exports GLB/source/metrics and three views, and inspects them through `view_render`. A dedicated photographer imports the archived GLB into a clean studio, renders and inspects three views, and supplies those exact images to the geometry judge and gallery. Geometry must pass before final texture/material work begins.
6. Each geometry or surface review receives actual renders, the visual target, user references, design, brief and metrics. Concrete prioritized corrections go to a fresh builder with the preceding source while that stage has rounds remaining. Texture requests and image targets have separate history, token usage and cost records.
7. Passing assets finish early. At the review limit, remaining issues stay visible as **completed with issues**, not an approval. Zero rounds performs the four modeling passes plus photography, with no judge. Technical failures are separate and can be retried; every attempt remains in history.
8. Final material exports render in a scale lineup and staged collection demo, with a downloadable scene. Geometry-only previews are excluded. The web app provides orbit/zoom previews, product renders, GLB/source downloads, design history, agent transcripts, and usage/cost breakdowns.

On a saved 3D model version, use the model conversation to prompt an iteration or fork a named variant. Each continuation is a linked model that starts from that version's archived Blender source, keeps the original history intact, snapshots its design and references, and uses a newly chosen review-round limit. The same panel can draft a new design reference from a selected model render. This creates a draft revision and adds the chosen view to project references; approve the revision before using it for later generation. Existing batches keep their original design snapshots.

For a graphics project, choose a square, portrait, or landscape canvas for the batch. Each planned image goes directly through the audited one-shot Image API adapter using `gpt-image-2` at high quality. Reference images are sent as edit inputs when present. The returned PNG is validated, stored with the project, exposed for preview/download, and recorded as an `imagegen` run with reported token usage. Graphics do not start Blender, run 3D judges, or create collection scenes.

Use **Collection style** to save shared construction lessons, style rules, variation and up to three finished examples. Future batches snapshot this guidance. A model's **Checks** tab can repair selected findings, revise it using current collection style, render its saved GLB again, or export a transparent sprite sheet. Graphic variants edit the selected saved image through the same audited Image API. Approved 3D projects can import a GLB or `.blend` as an editable baseline.

New builders edit persistent `asset.py`, run fixed `render.py`, inspect draft views and correct the script before final export. Versions include a downloadable source bundle: scripts and revisions, fixed parameters/seeds, pinned construction helpers, copied inputs and textures, source/delivery GLBs, and a manifest with hashes, toolchain versions and saved instructions. Extract it and run `python render.py --mode final` without an AI request, Eve or MCP. Use `--mode quick` for drafts and `--blender PATH` for a specific Blender installation. Draft previews are separate from final exports, and failed executions retain the preceding successful files while reporting failure. See [asset workshop](docs/asset-workshop.md) for reproducibility limits and older bundle commands.

Progress represents workflow milestones, not a predicted wall-clock percentage. New attempts apply the round limit per stage: two permits up to two geometry build/review pairs, then up to two surface pairs. Early passes skip unused rounds; geometry exhaustion withholds surface work. New v4 attempts require blockout → photography → shape refinement → photography → geometry judge, then materials → photography → polish → photography → surface judge. Additional review rounds repeat refinement or polish when needed. A first passing judge cannot skip these mandatory passes. Existing v1/v2/v3 attempts retain their original pipeline on resume. Resume reuses Eve sessions and completed step checkpoints. Every builder iteration retains an archived export and its judge feedback; collection thumbnails use only the latest version.

## Run locally

Requirements: Bun, Node 24+, Python 3.11+, Blender on PATH, and Docker for PostgreSQL.

Before starting services, copy `.env.example` to `.env` and configure the database and model provider privately. On machines without Codex provider configuration, set `OPENAI_API_KEY` and `OPENAI_BASE_URL` in the service environment. Model pricing is code-owned and selected from the exact model ID used by each run.

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

In VibePod, reuse the `asset-studio` managed preview. The PostgreSQL Compose project is named `studio`. Use `docker compose -p studio up -d --wait` to start it. PostgreSQL data lives in the gitignored workspace directory `data/postgres`, mounted into the container, so recreating Docker storage does not discard it. Preserve this directory alongside the asset files; do not delete it when cleaning generated assets. This is persistent storage, not a backup. The background service group runs in tmux as `asset-studio-services`:

```sh
tmux attach -t asset-studio-services
vibepod-preview logs asset-studio
vibepod-preview doctor asset-studio
```

Copy `.env.example` to `.env` if needed. The service supervisor loads `.env` once and passes the same settings to every child; Bun also reads `.env` for the app. `scripts/provider.py` passes credentials only to the configured provider and never prints or saves them. On a machine without Codex configuration, provide `OPENAI_API_KEY` and `OPENAI_BASE_URL` directly. For production builds, use `bun run build` and `bun .output/server/index.mjs` with `PORT` set.

## Architecture and persistence

- `src/routes/`: project list, project workspace, colocated history components, and API route.
- `src/components/model-viewer/`: reusable React Three Fiber GLB lightbox and scene controls.

`ModelViewer` accepts an optional GLB `src` (omit it to show sample cubes), `height`, and `alt`. Scene defaults can be set with `lighting="day" | "night"`, `showGrid`, and `showCubes`; interaction defaults use `mode="orbit" | "split" | "firstPerson"`, `autoRotate`, and `autoRotateSpeed`. Orbit mode rotates the camera around the model with bounded zoom. Split mode shows four independently orbitable directions: front, right, back, and left. `showOrientation` controls the view cube and its hover-revealed arrows, which move to adjacent faces; its small round arrow resets to an isometric view. `showUi={false}` removes the toolbar and hints for compact previews. `onLoad`, `onError`, `onModeChange`, and `onLightingChange` expose viewer events. The built-in toolbar changes scene options locally, so a parent that needs synchronized state should use the callbacks. First-person mode is a collision-free fly camera: click the scene to lock the pointer, use WASD or arrow keys to move, Space/E to rise, Shift/Q to descend, and Escape to release. In embedded frames that disallow pointer lock, drag on the focused canvas to look around and use the same movement keys. Import the viewer lazily on pages that do not always show a model. The workspace uses it on the dedicated model detail page and as an opt-in, UI-free quick preview on model cards; static renders remain the default so a large collection does not create many WebGL contexts.

The full viewer's camera menu captures the current scene as a PNG (all four panes in split mode). **Copy to clipboard** puts the PNG on the system clipboard for pasting into another app; **Download image** saves it with a model-based filename. Browser clipboard permissions may prevent copying, in which case the viewer reports the error and downloading remains available. A bottom-right button expands the viewer to fullscreen. UI-free card previews do not show screenshot actions.
- `src/lib/api.server.ts`: validated project/design/generation endpoints, uploads and downloads.
- `src/lib/pipeline.server.ts`: designer → planner → builder/judge → collection workflow.
- `src/modules/ai/internal/eve.server.ts`: fresh Eve sessions, structured output validation, event persistence and token accounting.
- `src/modules/ai/internal/tanstack.server.ts`: structured brief/design calls through TanStack AI, with persisted run results and usage estimates.
- `src/modules/ai/internal/image.server.ts`: Codex-configured Image API calls for graphics, visual targets, and textures, with durable receipts and usage accounting.
- `scripts/worker.ts`: PostgreSQL job claiming (`SKIP LOCKED`), bounded concurrency, coordinator lock and restart recovery.
- `src/db/schema.ts`, `drizzle/`: projects, immutable design revisions, batches, models, agent runs, events and jobs.
- `eve/agent/`: model configuration, authenticated local channel, native asset workspace and vision tools, plus the photography/legacy MCP connection.
- `blender/`: scoped script workspace, fixed offline runner, isolated Blender service, export helpers and collection renderer.
- `prompts/`: all system prompts, role prompts and input templates. Eve loads its shared instructions from this folder at build time.
- `data/`: immutable upload keys, per-attempt/per-iteration assets, collection renders, runtime logs and temporary build capabilities. Back up this directory together with PostgreSQL.

The worker re-adopts interrupted jobs on restart. Per-job database checkpoints retain Eve run/session IDs and completed step results. Recovery replays the durable Eve stream and reattaches to active work; explicit Resume continues failed turns in the same conversation. Builder workspaces and scoped capabilities survive recovery. Completed design/planner transactions are checkpointed atomically to prevent duplicate revisions or model batches. Token totals are reconstructed from session events with idempotent event storage, rather than added again on replay. Eve session storage and the data directory must be retained; missing/retired sessions and operator approval requests report errors rather than silently starting over. External Blender execution may be retried following an interruption, so scripts should be idempotent. It is a trusted local workshop, not a multi-tenant service: there is no end-user account system, and generated Blender Python runs with the service user's filesystem permissions. MCP and Eve bind to loopback. Put authentication and stronger execution isolation in front of an external deployment.

## Image transport lessons

Eve 0.63 accepts user images as **file parts with an image media type**, despite protocol types also mentioning image parts. The app sends data URLs in file parts. For tool images, use `toolOutput.content` + `toolOutputPart.file` in `view_render`. Raw MCP image blocks were serialized as text by this integration, inflating usage and exhausting context; they are blocked from the model-facing MCP tools. A regression test covers the vision output shape. `view_render` persists a small immutable image reference and loads its pixels only when assembling model input; this avoids counting base64 payloads as text during Eve context estimation. Older inline-image session records remain supported.

The configured gateway cannot retrieve non-persisted Responses item IDs. Eve explicitly uses `store: false`, so local assistant messages and paired function calls are serialized in full; reasoning history is omitted. Graceful shutdown requeues interrupted jobs with their checkpoints. The single-process local service uses a 60-second recovery lease instead of the SDK's 860-second default. New sessions do not expire automatically; per-request timeouts remain bounded. The administration Settings page persists runtime limits in `data/runtime-settings.json`; the worker and Blender service read it before each new operation, so saving needs no restart. Environment values remain first-run defaults: `AGENT_TIMEOUT_MS` defaults to 20 minutes, `BUILDER_TIMEOUT_MS` to 45 minutes, and `BLENDER_BUILD_TIMEOUT_SECONDS` to 600 seconds. A timed-out client explicitly cancels its Eve session so tools cannot continue writing after the job is marked failed.

## 3D asset contract

Every build has a ground-centered origin, meters, an individual GLB and `.blend`, named materials, reported triangle counts, and three consistent product renders. Textured mode validates embedded base-color and tangent-space normal maps on exported materials. Explicit poly mode rejects image textures. Triangle counts are reported for information; there is no triangle-budget setting or enforcement. Architectural openings, material scale, believable silhouettes, and the earlier bark texture lessons are in the prompts.

Requested assets can include meaningful part pivots, attachment sockets, modular grid declarations, collision/slot intent, named animation clips and timing events. Optional static LODs and transparent sprite sheets are local Blender outputs. Readiness checks report source topology, UV, transform and interface findings alongside artistic reviews; declarations do not establish engine physics, exact assembly fit or animation quality. The collection demo remains a staged presentation at shared scale. There is no PBR-map generation feature.

## Token accounting and cost

Each run stores the role, prompt content/hash, concrete input, image keys, structured/text output, events including tool calls, model/session IDs, timestamps, input/output/cache tokens, usage source, and a pricing snapshot. Project totals include setup/planning and failed attempts. Model totals include all its build/judge attempts. Individual iterations are expandable in **Activity & cost**.

Provider `costUsd` is not used. Estimates are calculated as:

```
((input - cache_read - cache_write) × input_rate
 + cache_read × cached_rate
 + cache_write × cache_write_rate
 + output × output_rate) / 1,000,000
```

The code-owned catalog follows official OpenAI standard rates for [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), and [GPT Image 2](https://developers.openai.com/api/docs/pricing#image-generation). It includes cache-write rates, per-request long-context multipliers, and GPT Image 2's separate text-input, image-input, and image-output token rates. Provider-prefixed model IDs such as `openai/gpt-6-astra` resolve to the same catalog entry. Unknown model overrides remain usable but are explicitly unpriced instead of inheriting another model's rates. These are estimates, not invoiced charges, and every run stores its resolved rate snapshot.

If step usage is absent/zero, the adapter estimates text at four characters per token, adds 1,000 tokens per image per step, and approximates tool context. Records distinguish reported, estimated, mixed, pending and not-started usage. Hidden reasoning and image tokenization can differ from these assumptions. A rejected request before model execution has zero model tokens. Local Blender CPU time has no model-token charge; elapsed run time is recorded separately. Imagegen requests store the reported token-class split and use the matching model catalog entry.

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

The header has one Admin entry. Its responsive subnavigation opens Queue, Agents, Diagnostics and Settings. Queue lists model generation, planning and collection-render jobs, with per-job cancellation and Abort pending queue. Operators can pause future claims and choose one to four concurrent jobs; work already claimed continues normally. Running cancellations are cooperative: the UI shows Cancelling until the worker stops. Cancelled jobs are not resumed automatically. Model iteration history lives in each model viewer; previous GLBs, Blender files, renders and judge reviews stay accessible.

Diagnostics reports redacted database, worker, Eve, Blender and storage health plus recent failed job kinds. It deliberately omits credentials, service URLs, process IDs, executable paths and filesystem paths. Settings controls generation defaults and the full set of operation timeouts. Changes are validated, written atomically to `data/runtime-settings.json` and applied to new work without a restart. Pricing is repository-managed rather than operator-configurable.

## AI module boundaries

Use `src/modules/ai/index.server.ts` (`runRole`, `roleInput`) for all AI work. Role definitions live in `src/modules/ai/roles.ts`; callers must not import adapter internals. `src/modules/pipelines/index.ts` defines provider-independent pipeline traversal and the model review sequence. Asset-specific handlers remain in `src/lib/pipeline.server.ts`. See [AI architecture](docs/ai-architecture.md) for extension, recovery and accounting contracts.

## Role settings and generated textures

`/admin/agents` displays each role's engine and read-only prompt source, and lets operators override its model and effort or image quality for new requests. Code still owns engines, schemas and prompts. Builder and judge default to `gpt-6-astra` at high effort, photographer to `gpt-6-astra` at medium effort, and other text roles to `gpt-6-sol` at medium effort. Each run snapshots its selected profile and pricing, so later code changes do not rewrite history or alter resumed work. Eve reads a saved `data/session-config/<sessionId>.json` model/effort snapshot before each model step. Keep these files with the database and Eve storage. Rebuild/restart Eve when its tool or model adapter changes.

Astra estimates use [documented standard token rates](https://developers.openai.com/api/docs/models/gpt-6-astra): $10/M input, $1/M cached input, $12.50/M cache writes and $50/M output, with the long-context multiplier evaluated per model call. Sol uses $2/$0.20/$2.50/$10 for the same token classes. These remain estimates rather than invoices.

The builder-only `generate_texture` tool calls `/api/textures/generate` with its workspace capability. The server uses the TypeScript Image API adapter in `src/modules/ai/internal/image-api.ts` for both textures and visual targets. It shares provider resolution with the direct text adapter, sends reference images as multipart edits, and records returned image-token usage and configured cost estimates. No Python environment or installed imagegen skill is required. Python remains for Blender/BMesh and Trimesh/libigl analysis.

Requests retain their existing history, receipts and cancellation checks. There are no automatic API retries; resume creates a separately tracked request after a failure. Old completed image receipts remain reusable. Keep `STUDIO_APP_URL` pointed at the app's loopback URL/port for Eve's tool (default port 34193). Credentials are resolved server-side and never stored with artifacts. `STUDIO_IMAGEGEN_PYTHON` and `STUDIO_IMAGEGEN_SKILL` are obsolete and ignored.

Generated base colors must be connected to UV-mapped materials; matching normal maps remain part of the asset contract. Poly mode skips texture generation but still receives a visual target.


Image generation logs inputs, output paths, status and raw reported token usage separately in Activity & cost. GPT Image 2 uses the [official standard token rates](https://developers.openai.com/api/docs/pricing#image-generation): $5/M text input, $8/M image input, $1.25/M cached text input, $2/M cached image input and $30/M image output. Provider cost fields are ignored. An interrupted image request can incur unknown usage; retrying can create another charge. Successful identical texture requests reuse their saved receipt. Migration `0010` backfills previously unpriced GPT Image 2 runs when their saved usage receipt contains the required token split.

The model viewer's **Textures** tab shows generated/source PNGs and the actual embedded GLB textures for the selected iteration. Existing archives without a texture manifest show an explicit empty state. Model thumbnails still use only the latest renders.

## Reference images and media storage

The project dialog uses a Roastbook-style image picker: choose files, drag and drop, paste a copied image while the picker is focused, or expand **From URL** and paste a direct image link. Pasting a URL onto the picker opens the URL field. Thumbnails can be removed individually. PNG, JPG and WebP are supported, with a maximum of six references and 8 MB per image. URL imports validate public HTTP(S) destinations on every redirect, pin DNS addresses, enforce a download deadline and byte limit, and verify image signatures. They remain temporary browser selections until the brief or project is saved.

Reopening a draft displays its saved references. Generating a brief saves the selected references; subsequent requests reuse their keys. Removing every thumbnail explicitly clears a draft's references when it is next saved. Removed persisted files are retained because earlier AI runs can still refer to them.

`src/lib/storage/` adopts Roastbook's `StorageProvider` interface: upload, download, delete, getUrl, exists, list and listObjects. The local provider is the default and preserves existing `data/` keys. Set `STORAGE_PROVIDER=s3`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` to use S3; `S3_ENDPOINT` enables a custom S3-compatible endpoint with path-style addressing. Apply the same settings to the app and worker, then restart both.

New reference images and completed version/collection outputs use the configured provider. File serving and AI image transport read through that layer; private bucket objects are served by the app's existing `/api/files/` URLs. Existing local files remain readable when S3 returns “not found”; switching providers does not migrate or delete data. Blender working files, generated visual targets, Eve sessions, checkpoints and local archives still require `STUDIO_DATA_DIR`. S3 is media storage, not a replacement for backing up PostgreSQL and the local working directory.

Storage unit tests run with `bun run test`. S3 integration tests require an isolated endpoint and `TEST_S3_ENDPOINT`, `TEST_S3_ACCESS_KEY_ID`, and `TEST_S3_SECRET_ACCESS_KEY`; the test creates a unique bucket. Reference submission integration tests require `TEST_REFERENCE_DATABASE=1` and a migrated, isolated `DATABASE_URL` with **no worker attached**, because the test creates and removes its own queued design job. No paid generation is needed.

## Project thumbnails

After each generation batch settles, a queued photographer session renders all latest published project models together, across batches. The newest completed photo becomes the project card's thumbnail; the reference image is the fallback. Geometry previews can be included before final materials exist. Photo history, source versions, token usage and estimates remain in Activity & cost. Queue shows project photography progress, cancellation and Resume for failures. Existing projects can refresh with `POST /api/projects/<id>/photograph`.

## GLB handover

Every new builder iteration passes through deterministic local post-processing before its GLB is archived, photographed or published. The ordered passes live in `src/modules/glb/handover.ts`; no AI request or token cost is involved. The first pass replaces `asset.generator` with `Sticks & Clay` and removes known exporter-identification keys from glTF extras (including Blender metadata). Copyright/license attribution, semantic names, custom properties, functional extensions and binary mesh/texture chunks are preserved.

Each version stores a `handover.json` receipt with pass versions, input/output SHA-256 hashes and sizes. The published byte metric reflects the processed file. Malformed GLBs fail before publication and can be repaired through the normal builder resume path. Published historical archives retain their original bytes and photography hashes.

Model photography now provides seven review images: front/rear three-quarter, detail, both sides, top and underside (studio floor hidden for the underside). The judge receives these exact validated archived images, followed by the visual target and user references, with dynamic numbered labels. Planner, builder, model photographer and judge receive user reference images; project-cover photography receives them too. Existing photographer sessions retain their three-view contract on resume. Collection covers still use three presentation views.

### Deterministic model findings and safe export cleanup

The existing judge handler runs read-only analysis of the exact archived GLB used
for photography. Its JSON report (including GLB SHA-256, object names, sampled
original GLB node/mesh/primitive triangle IDs, counts and coverage limitations) is included in the
persisted judge input. There is no new stage or pass/fail gate. Missing tools or
timeouts are reported as unavailable evidence, not a clean model.

- `src/modules/model-analysis/extract.ts`: glTF-Transform decodes original GLB
  accessors without importing through Blender or repairing invalid faces. Each
  texture slot is checked against its actual UV set, including texCoord overrides.
- `blender/analyze_extract.py`: BMesh checks exact-position topology copies of
  those raw arrays so UV/normal seams do not appear as holes.
- `blender/analyze_mesh.py`: Trimesh checks degenerate/duplicate triangles, winding,
  inverted closed shells, tiny islands, collapsed/missing textured UVs and extreme
  extents. libigl CGAL uses `detect_only=True` for within-object self-intersections
  on meshes up to 100,000 triangles without duplicate/degenerate faces. It stops
  at the first intersection; its count is explicitly marked as a lower bound.
  Fast findings are saved atomically before CGAL and after each intersection check;
  native failures/timeouts preserve partial evidence. Missing BMesh does not prevent
  the raw geometry and UV checks.
- `src/modules/model-analysis/`: bounded subprocess adapter (90s Blender, 60s analysis).
  Install `blender/requirements.txt` in `.venv`; `BLENDER_BIN` and `ANALYSIS_PYTHON`
  can override executable paths. Open boundaries and islands may be intentional.
  Cross-object intersections, near-coplanar Z-fighting, density budgets, UV tiling
  and shading-normal heuristics are deliberately not inferred. Exact coincident
  triangles are reported. Findings are capped at 80 with 20 face samples each.

At the existing per-export archive handoff, `src/modules/glb/cleanup.ts` uses
glTF-Transform to weld bitwise-equivalent vertices, simplify large opaque triangle
meshes toward 50% of their original triangles within a 0.1% geometric-error limit,
deduplicate accessors and prune unused resources after index optimization, including
its replaced accessors. Meshoptimizer keeps mesh borders locked during simplification
and reorders opaque triangle indices. Small and transparent meshes are not simplified;
transparent exports also skip reordering. Texture image bytes, UV/normal seams,
materials and scene nodes are preserved. Extensions, skins, animations, morph targets,
non-triangle primitives, URI resources and unknown chunks bypass cleanup; exceptions
fall back to the input. No repair, quantization or lossy texture compression is
performed. The handover receipt records cleanup steps, pre/post triangle counts or the
skip reason before applying the tool's generator marker; published metrics use the
post-cleanup triangle count.
Cleanup precedes immutable photography, so the judge and download see the same
model. Old archived versions are never rewritten.

Tests: `bun test src/modules/glb`, and
`.venv/bin/python -m unittest discover -s blender -p 'test_analy*.py'`.
Set `BLENDER_BIN` to also run the real import/BMesh regression test and
`bun test src/modules/model-analysis` for the subprocess adapter integration test.
