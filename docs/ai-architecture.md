# AI execution and pipelines

## Current state and feedback loop

The previous workflow selected providers and schemas at call sites. Provider adapters also duplicated run creation and pricing configuration. The refactor keeps their recovery/accounting algorithms and existing database history, behind one typed execution boundary.

Fast checks: `bun run typecheck` and `bun test src/modules`. Full gate: `bun run verify`. Database replay gate: `TEST_DATABASE=1 bun test src`. Tests reuse completed fixtures without paid requests.

## Module map

| Module | Responsibility | Boundary |
|---|---|---|
| `src/modules/ai` | Role definitions, engine routing, logged execution | `index.server.ts`; pure definitions in `roles.ts` |
| `src/modules/pipelines` | Ordered steps, bounded repetition, early completion | `index.ts` |
| `src/lib/pipeline.server.ts` | Asset-specific inputs, files, version archives, progress, finalization | Worker job handler |
| Queue/checkpoints | Scheduling, cancellation, durable job identity | Existing queue/checkpoint modules |
| `prompts/` | Editable system instructions and input templates | Loaded by registered role |

## Execution interface

`runRole({ role, projectId, input, images?, batchId?, modelId?, iteration?, stepId? })`
returns `{ result, runId }`. The result type and runtime validation come from the role registry. `roleInput(role, values)` renders its input template. Callers cannot choose a conflicting engine or output schema.

| Roles | Engine | Recovery |
|---|---|---|
| project-brief, model-brief, designer | TanStack AI | Completed result reuse; interrupted request is a new attempt |
| planner, builder, judge | Eve | Attach/replay/continue the saved session |
| visual-target, texture | Codex imagegen skill | Completed receipt/run reuse; interrupted request retries separately |

Legacy designer jobs with Eve checkpoints retain Eve execution. New Eve work requires a durable job context. The execution module never enqueues work. Brief buttons call it immediately; design generation uses a background job for UI responsiveness and result application. Saving request history does not make an API conversation resumable.

The internal accounting module owns run creation and pricing snapshots. Adapters own usage collection because TanStack response usage and Eve event replay have different semantics. Both persist to the historical `agent_runs` table, now with explicit `engine` and `step_id`. Provider cost fields remain ignored. Unknown failed usage stays unknown; Eve event replay does not add the same costs twice.

## Pipeline interface

`runPipeline(definition, handlers, beforeStep)` traverses named nodes. Each node has a task, iteration, next node, and optional `stopOnPass`. Handlers receive the stable node identity; `beforeStep` enforces cancellation before and after each execution. Missing links, duplicate IDs, missing handlers, and cycles fail before work starts. Repeat nodes must be expanded with unique IDs, making limits explicit.

`modelReviewPipeline(rounds)` retains the legacy builder → judge → builder workflow, with at most N build/review pairs, early approval, and a single unreviewed build for zero rounds. The job checkpoints its definition version. Future versions must retain a dispatch path for saved versions or explicitly reject them.

`qualityPipeline(rounds)` adds a geometry gate before surface builds. Geometry passes use a conditional `passNext`; exhaustion stops without surface work. See [quality pipeline](quality-pipeline.md) for limits, target thumbnails and recovery. The public `runImageRole` entrypoint logs image requests without creating Eve sessions.

To add another workflow, define its nodes and handlers. In handlers call `runRole` with `stepId: node.id` (use a pipeline/version prefix if multiple pipelines share a job). Repeated uses of a role must have distinct step IDs. Pass results into later inputs explicitly; archive artifacts in the handler before advancing. The existing model pipeline retains legacy `agent:role:iteration` checkpoint keys so old jobs still resume.

Traversal restarts from the first node on recovery. Completed AI results are reused; handler side effects must be idempotent, and final database writes must use the existing atomic `applied` checkpoint pattern. This is orchestration infrastructure, not a general exactly-once transaction engine. Tool authorization remains in Eve/MCP and scoped Blender capabilities; role instructions are not security boundaries.

## Filesystem and enforcement

Eve and TanStack adapters moved from `src/lib` to `src/modules/ai/internal`. Only the public AI entrypoint imports them. An architecture test rejects external imports of internal modules. Pipeline traversal has no provider, database, or filesystem dependency. Asset handlers own those effects.

## Migration and verification

1. Move existing adapters behind the execution facade, keeping checkpoint identities and recovery logic.
2. Centralize role schemas, prompts, engine policy, run creation and pricing snapshots.
3. Add engine/step metadata with an additive migration; retain history and session IDs.
4. Move review ordering into a versioned pipeline definition; preserve artifact handlers.
5. Verify routing, termination, cancellation, graph validation, cross-task checkpoint rejection, completed-result replay, session retention, and unchanged cost totals.

Adding a role requires its registry entry, prompts and schema. Adding a provider requires an internal adapter implementing logged execution and its recovery semantics. Neither change should require consumers to import adapter internals.

## Role model selection

Each role specifies `model` and `effort` in code. New runs snapshot both. Eve's dynamic step resolver loads a per-session file written before submission, so continuation does not read changed role defaults. The read-only `/admin/agents` page lists the registry. TanStack calls pass the role effort to the Responses adapter. The imagegen tool is a separate capability exposed only in builder sessions, with its own usage records and retained texture outputs.
