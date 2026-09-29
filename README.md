# Asset Studio

A working game-asset pipeline application, built alongside CodeTend with the same core stack: **Bun, React 19, TanStack Start/Router, Vite, Tailwind 4, Drizzle/PostgreSQL, and Eve**. Three.js provides the interactive GLB viewer; Blender runs locally through an isolated MCP adapter.

## Workflow

1. Create a project from a description, up to six reference images, or both.
2. A designer agent inspects the images and writes a Markdown design reference. The database stores the document and revisions. Edit it, then save and approve it.
3. Request a concrete model or ask the planner to propose a set. Choose 1–20 models and 0–5 maximum judge rounds. A batch snapshots the approved design; later edits cannot change its contract.
4. A PostgreSQL job queue dispatches independent builders, with two concurrent workers by default. Each attempt and iteration has a unique Blender directory. Complete scripts execute in separate Blender processes, never a shared live scene.
5. The builder exports an individual GLB, Blender source, metrics, and front/rear/detail renders. It visually inspects renders through Eve's `view_render` vision tool.
6. When judging is enabled, a fresh agent receives the three rendered images, design, brief, and metrics. It returns a score, pass/fail decision, and prioritized concrete fixes. Failed reviews trigger a fresh builder with prior source and feedback while rounds remain.
7. Passing assets finish early. At the review limit, remaining issues stay visible as **completed with issues**, not an approval. Zero rounds means one build with no judge. Technical failures are separate and can be retried; every attempt remains in history.
8. Completed batches render a scale lineup and a staged collection demo, with a downloadable scene. The web app provides orbit/zoom previews, product renders, GLB/source downloads, design history, agent transcripts, and usage/cost breakdowns.

Progress represents workflow milestones, not a predicted wall-clock percentage. A judge round includes a build and its review, so a limit of two allows at most two builds and two reviews per attempt. Retry starts a new attempt and preserves prior files, costs, and feedback.

## Run locally

Requirements: Bun, Node 24+, Python 3.11+, Blender on PATH, and Docker for PostgreSQL.

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

- `src/routes/`: project list, project workspace, colocated viewer/history components, and API route.
- `src/lib/api.server.ts`: validated project/design/generation endpoints, uploads and downloads.
- `src/lib/pipeline.server.ts`: designer → planner → builder/judge → collection workflow.
- `src/lib/agent.server.ts`: fresh Eve sessions, structured output validation, event persistence and token accounting.
- `scripts/worker.ts`: PostgreSQL job claiming (`SKIP LOCKED`), bounded concurrency, coordinator lock and restart recovery.
- `src/db/schema.ts`, `drizzle/`: projects, immutable design revisions, batches, models, agent runs, events and jobs.
- `eve/agent/`: model configuration, authenticated local channel, Blender MCP connection and authored vision tool.
- `blender/`: isolated MCP service, export/render helpers and collection renderer.
- `prompts/`: designer, planner, builder, judge, and the reusable asset pipeline developed in the earlier tree/castle work.
- `data/`: immutable upload keys, per-attempt/per-iteration assets, collection renders, runtime logs and temporary build capabilities. Back up this directory together with PostgreSQL.

The worker is durable at job boundaries. Queued work survives restart. Interrupted running work is marked failed and its Eve turn is cancelled; retry is explicit to avoid silently duplicating paid work. It is a trusted local workshop, not a multi-tenant service: there is no end-user account system, and generated Blender Python runs with the service user's filesystem permissions. MCP and Eve bind to loopback. Put authentication and stronger execution isolation in front of an external deployment.

## Image transport lessons

Eve 0.63 accepts user images as **file parts with an image media type**, despite protocol types also mentioning image parts. The app sends data URLs in file parts. For tool images, use `toolOutput.content` + `toolOutputPart.file` in `view_render`. Raw MCP image blocks were serialized as text by this integration, inflating usage and exhausting context; they are blocked from the model-facing MCP tools. A regression test covers the vision output shape.

The configured gateway also cannot replay non-persisted reasoning item IDs. The Eve model uses the same reasoning-history stripping middleware pattern as CodeTend.

## Asset contract

Every build has a ground-centered origin, meters, an individual GLB and `.blend`, named materials, controlled triangles, and three consistent product renders. Textured mode validates embedded base-color and tangent-space normal maps on exported materials. Explicit poly mode rejects image textures. The helper enforces the triangle limit the builder supplies, and the judge checks reported metrics against the design text. Architectural openings, material scale, believable silhouettes, and the earlier bark texture lessons are in the prompts.

This version produces the primary asset and presentation scene. Engine-specific collision generation, LOD chains, animation, and exact modular assembly validation are future extensions. The collection demo is a staged presentation at shared scale, not automatic semantic level assembly.

## Token accounting and cost

Each run stores the role, prompt content/hash, concrete input, image keys, structured/text output, events including tool calls, model/session IDs, timestamps, input/output/cache tokens, usage source, and a pricing snapshot. Project totals include setup/planning and failed attempts. Model totals include all its build/judge attempts. Individual iterations are expandable in **Activity & cost**.

Provider `costUsd` is not used. Estimates are calculated as:

```
((input - cache_read) × input_rate + cache_read × cached_rate + output × output_rate) / 1,000,000
```

Configured default assumptions are $2/M input, $0.20/M cached input and $10/M output for the configured GPT-6 Sol model. Verify/set current rates when selecting a model; these are estimates, not invoiced charges. Stored rates preserve reproducibility when configuration changes later.

If step usage is absent/zero, the adapter estimates text at four characters per token, adds 1,000 tokens per image per step, and approximates tool context. Records distinguish reported, estimated, mixed, pending and not-started usage. Hidden reasoning and image tokenization can differ from these assumptions. A rejected request before model execution has zero model tokens. Local Blender CPU time has no model-token charge; elapsed run time is recorded separately. Image-generation services are not used by this implementation.

## Verification

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
