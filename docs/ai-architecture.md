# AI execution and pipelines

## Execution boundary

The role registry selects providers, prompts, and output schemas. A typed execution boundary records each run and its pricing snapshot. Provider adapters retain their own recovery and usage-accounting behavior.

Fast checks: `bun run typecheck` and `bun test src/modules`. Full gate: `bun run verify`. Database replay gate: `TEST_DATABASE=1 bun test src`. Tests reuse completed fixtures without paid requests.

## Module map

| Module | Responsibility | Boundary |
|---|---|---|
| `src/modules/ai` | Role definitions, engine routing, logged execution | `index.server.ts`; pure definitions in `roles.ts` |
| `src/modules/pipelines` | Ordered steps, bounded repetition, early completion | `index.ts` |
| `src/lib/pipeline.server.ts`, `src/lib/model-pipeline.server.ts` | Job coordination, asset-specific inputs, files, version archives, progress, finalization | Worker job handlers |
| Queue/checkpoints | Scheduling, cancellation, durable job identity | Existing queue/checkpoint modules |
| `prompts/` | Editable system instructions and input templates | Loaded by registered role |

## Execution interface

`runRole({ role, projectId, input, images?, batchId?, modelId?, iteration?, stepId? })`
returns `{ result, runId }`. The result type and runtime validation come from the role registry. `roleInput(role, values)` renders its input template. Callers cannot choose a conflicting engine or output schema.

| Roles | Engine | Recovery |
|---|---|---|
| Project/graphic names, briefs, designs, and material roles | TanStack AI | Completed result reuse; interrupted request is a new attempt |
| Collection planners, builder, photographer, judge | Eve | Attach/replay/continue the saved session |
| visual-target, texture, graphic, design-mockup | Image API | Completed receipt/run reuse; interrupted request retries separately |

Legacy designer jobs with Eve checkpoints retain Eve execution. All text roles except name and brief drafting require a durable job context. The execution module never enqueues work. Brief buttons call it immediately; design generation uses a background job for UI responsiveness and result application. The queue lists all durable jobs and immediate drafting runs. Immediate drafts return to their forms and cannot be stopped or resumed through worker controls. Saving request history does not make an API conversation resumable.

Design updates from models retain the current revision while the job runs. The project and source model show the active work. Design saves and additional updates lock the project row and reject active design jobs. Completion creates a revision awaiting approval; an editor with unsaved changes must load that revision before saving or approving.

The internal accounting module owns run creation and pricing snapshots. Adapters own usage collection because TanStack response usage and Eve event replay have different semantics. Both persist to the historical `agent_runs` table, now with explicit `engine` and `step_id`. Provider cost fields remain ignored. Unknown failed usage stays unknown; Eve event replay does not add the same costs twice.

Resuming a running Eve turn follows the saved session through idle stream reconnects until a terminal event or the configured role deadline. Quiet Blender work must not exhaust the SDK's default idle reconnect limit. A deadline cancels the retained session and records a timeout; it does not submit another turn. Completed turns still require artifact validation before the pipeline advances.

Optional `design-mockups` jobs snapshot the approved design's rendered prompts and reference keys when queued. Each completed image is checkpointed independently; resume reuses completed image runs and retains the original inputs. Mockups do not change project approval, collection assets or uploaded references. Their gallery is read from job checkpoints, with costs in the ordinary run history.

## Pipeline interface

`runPipeline(definition, handlers, beforeStep)` traverses named nodes. Each node has a task, iteration, next node, and optional `stopOnPass`. Handlers receive the stable node identity; `beforeStep` enforces cancellation before and after each execution. Missing links, duplicate IDs, missing handlers, and cycles fail before work starts. Repeat nodes must be expanded with unique IDs, making limits explicit.

`modelReviewPipeline(rounds)` retains the legacy builder → judge → builder workflow, with at most N build/review pairs, early approval, and a single unreviewed build for zero rounds. The job checkpoints its definition version. Future versions must retain a dispatch path for saved versions or explicitly reject them.

`qualityPipeline(rounds)` preserves the v2 geometry gate before surface builds; `photographyPipeline(rounds)` preserves the v3 graph. New jobs use `refinementPipeline(rounds)` with v4 blockout, refinement, materials, and polish passes. Geometry passes use a conditional `passNext`; exhaustion stops without surface work. See [quality pipeline](quality-pipeline.md) for limits, target thumbnails and recovery. The public `runImageRole` entrypoint logs image requests without creating Eve sessions.

To add another workflow, define its nodes and handlers. In handlers call `runRole` with `stepId: node.id` (use a pipeline/version prefix if multiple pipelines share a job). Repeated uses of a role must have distinct step IDs. Pass results into later inputs explicitly; archive artifacts in the handler before advancing. The existing model pipeline retains legacy `agent:role:iteration` checkpoint keys so old jobs still resume.

Traversal restarts from the first node on recovery. Completed AI results are reused; handler side effects must be idempotent, and final database writes must use the existing atomic `applied` checkpoint pattern. This is orchestration infrastructure, not a general exactly-once transaction engine. Tool authorization remains in Eve/MCP and scoped Blender capabilities; role instructions are not security boundaries.

## Reviewed single-artifact assets (graphics, SVG)

Every non-3D asset type runs through `runReviewedAsset` (`src/lib/reviewed-asset.server.ts`) using the shared `reviewPipeline(rounds)`: build, review, then revise from the judge's findings, for up to N rounds with early approval; zero rounds is one unreviewed build. The runner owns progress, the stored review, verdicts (`approved`, `limit_reached`, `unreviewed`), saved pipeline version and recovery. A type supplies only an `AssetKind` (`build` and the judge role) and registers it in `assetKinds` (`src/lib/asset-kinds.server.ts`), typed over every non-3D `assetType`, so a new type cannot compile without one and cannot skip review.

SVG's equivalent of the Blender workshop is `src/lib/svg.ts` (allowlist sanitizer, structural analysis) plus `src/lib/svg-render.server.ts` (sharp/librsvg rasterizer and ink-bounds measurement). The judge sees a 768 px render, a 64 px legibility render and the measurements. Iteration 0 keeps the original step ID and file layout so jobs saved before review rounds resume unchanged. Raster graphics use the image API for builds and the generated PNG as the judge's evidence. 3D keeps its own staged pipelines in `model-pipeline.server.ts`.

## Filesystem and enforcement

Eve and TanStack adapters live in `src/modules/ai/internal`. Only the public AI entrypoint imports them. An architecture test rejects external imports of internal modules. Pipeline traversal has no provider, database, or filesystem dependency. Asset handlers own those effects.

## Extending execution

Adding a role requires its registry entry, prompts and schema. Adding a provider requires an internal adapter implementing logged execution and its recovery semantics. Neither change should require consumers to import adapter internals.

## Role model selection

Each role specifies default `model` and `effort` in code. The runtime `textPreset` setting (Admin → Settings) maps the default text models to their Claude equivalents (`gpt-6-sol` → `claude-sonnet-5-5`, `gpt-6-astra` → `claude-opus-5-5`) for new runs; the same gateway serves both, image roles are unaffected, and per-role overrides take precedence. Claude models have no pricing rates yet, so their costs show as unavailable. `/admin/agents` lists the registry and lets the owner set overrides for new runs. New runs snapshot both settings. Eve's dynamic step resolver loads a per-session file written before submission, so continuation does not read changed defaults or overrides. TanStack calls pass the role effort to the Responses adapter. The texture-generation tool is a separate capability exposed only in builder sessions, with its own usage records and retained outputs.

Design chat queues `design-update` jobs with the requested changes, project context, saved document/version and references frozen in the checkpoint. The `design-update` and `graphic-design-update` roles share the revision input template and use their respective designer instructions. Results create a new draft and revision, with the resulting version recorded on the job; approval stays explicit. Failure and cancellation preserve the saved design. Project responses retain each request and outcome for the conversation history.
