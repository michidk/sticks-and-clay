# GitNexus Engineering Plan

> Task: Add comprehensive, safe admin runtime configuration, queue controls, agent profiles, pricing, generation defaults, and diagnostics.
> Evidence verified at commit e06b584b3d38495fd4dc3bdc85a8380529262b8a; GitNexus index commit-current with no incomplete reasons, but analyzer provenance is source-weighted because the project runner is 1.6.11 while the persisted schema-4 index runner is 1.6.12.
> Evidence provenance schema 2; global dirty digest 9dc62ab33f4449332da4ff67567f2056c987437a8669be41352f77772f895b2d; cited-path manifest 12 sorted entries; exact generated plan path excluded.

## 1. Objective

Provide one coherent admin operations surface for safe runtime configuration and read-only diagnostics. Changes must apply to new work, preserve existing run/session pricing and execution snapshots, dynamically pause or limit future queue claims without interrupting active jobs, and never expose credentials or internal executable/filesystem paths.

## 2. Current Behaviour

- [verified] `runtimeSettingsSchema` and `loadRuntimeSettings` persist only three timeout values in `data/runtime-settings.json`; a missing file uses environment-backed defaults.
- [verified] `lane` starts 1–4 fixed workers from `WORKER_CONCURRENCY` and atomically claims a queued job at the top of each loop.
- [verified] AI role model/effort/quality and Astra pricing are code constants; default text and image rates come from environment variables.
- [verified] Runs already persist model, effort, prompt version, usage, and rate snapshots, so later configuration changes need not rewrite history.
- [verified] TanStack, image generation, collection rendering, and model analysis contain fixed timeouts outside runtime settings.
- [verified] Project generation defaults are hardcoded to one asset, two judge rounds, and square graphics while API limits remain 1–20 and 0–5.
- [verified] Admin already has one top-level navigation item and route-private Queue, Agents, and Settings pages in the required TanStack folder layout.

## 3. Relevant Architecture

- [verified] Shared validated contracts live in `src/lib/contracts.ts`; server-only persistence belongs in `src/lib/*.server.ts`; route-only UI belongs below `src/routes/admin/**/-components`.
- [verified] All AI execution crosses `src/modules/ai/index.server.ts`; authored prompts and result schemas remain repository-owned in `roles.ts` and `prompts/`.
- [verified] The API is a single request router in `src/lib/api.server.ts`; new admin endpoints must preserve its origin validation for writes.
- [inferred] A versioned effective runtime configuration, normalized from old flat files, is the smallest durable seam shared by web and worker processes.

## 4. GitNexus Findings

- [graph] `context(loadRuntimeSettings)` reports direct callers `api` and `agent`, plus its server test; `impact(upstream,maxDepth:3)` reports CRITICAL reach through AI and pipeline flows. Source verification confirms both direct production callers.
- [graph] `context(runRole)` reports direct callers in API, pipeline builder/judge/photographer, project photography, and integration tests; changes must keep engine dispatch and durable Eve context intact.
- [graph] `context(lane)` reports worker-local ownership of job claiming and calls into execute/failure/cancellation paths; direct source confirms the claim precedes active execution.
- [graph] `context(pricingSnapshot)` reports direct Eve and TanStack consumers; image pricing is a separate source-verified path.
- [graph] `impact(api)` is lower-bound because one receiver-typed call was dropped, so API assertions rely on source/integration tests rather than absence of graph callers.

## 5. Statement-Level PDG Findings

- [graph] `pdg_query(controls,scripts/worker.ts)` shows the atomic SQL claim is controlled only by `while (!stopping)`; once claimed, completion, cancellation, interruption, and failure branches are independent. Pause and lane eligibility must guard the claim, never active work.
- [graph] `pdg_query(flows,loadRuntimeSettings,path)` shows the path parameter flows directly to file read and schema parse. Compatibility normalization belongs at that parse boundary.
- [graph] `pdg_query(controls,runRole)` shows engine policy controls Eve versus TanStack dispatch and the Eve branch is guarded by durable job context. Configurable fields must not make engine/schema/prompt policy editable.

## 6. Proposed Changes

1. Extend `runtimeSettingsSchema`, `runtimeSettingsDefaults`, `loadRuntimeSettings`, and `saveRuntimeSettings` into a versioned nested safe configuration with legacy flat-file normalization and validated partial updates.
2. Add safe resolvers for effective text/image agent profiles and pricing; use them when a new run/request is created while retaining saved run/session values during recovery.
3. Add queue pause/concurrency settings, a testable lane eligibility helper, dynamic four-lane worker gating, and an atomic redacted heartbeat file.
4. Replace fixed TanStack, image, collection, and analysis timeouts with effective runtime values; update Blender's settings reader for nested compatibility.
5. Add a server-only diagnostics snapshot for database, worker, Eve, Blender, storage usage/capacity, recent failure summaries, effective safe configuration, and restart flags.
6. Add validated settings/queue/agent/diagnostics API behavior without returning secrets or internal paths.
7. Rework admin pages into polished route-local controls: Queue operations, editable Agents profiles with read-only prompts, grouped Settings, and a new Diagnostics page/sidebar item.
8. Load generation defaults into the existing project dialog while keeping 1–20 assets and 0–5 rounds fixed; preserve the staged user-owned `TriangleCount` change in the same file.
9. Update documentation and add unit/integration coverage for migration, validation, snapshot behavior, lane gating, redaction, and configurable defaults/timeouts.

## 7. Implementation Sequence

1. Implement the versioned configuration contract, defaults, compatibility loader, merge-save helper, and focused tests.
2. Implement profile/pricing resolvers and update new-run AI consumers with snapshot-regression tests.
3. Implement queue control/heartbeat and diagnostics server modules, then update worker claiming and all timeout consumers.
4. Extend API routes and tests for partial settings updates, queue control, agents, diagnostics, and safe response shapes.
5. Build route-local Queue, Agents, Settings, and Diagnostics UI and responsive sidebar styling.
6. Wire project generation defaults in the existing route using narrow hunks that preserve concurrent TriangleCount work.
7. Update docs, run full verification and integration tests, inspect desktop/phone admin routes, and run preview doctor.

## 8. Test Strategy

- `src/lib/runtime-settings.server.test.ts`: old flat file → normalized v2 defaults; invalid nested values rejected; atomic save and partial update preserve unrelated sections.
- New pure queue-control test: paused or out-of-range lane cannot claim; active lane eligibility changes dynamically; bounds remain 1–4.
- AI accounting/profile tests: configured model/effort/rates apply to newly created records; saved rates/model remain authoritative on resume.
- Timeout tests: each consumer selects its named runtime value and existing builder ≥ Blender constraint remains enforced.
- Diagnostics tests: unavailable services degrade independently; credentials, URLs, filesystem paths, and raw failure text are absent.
- API integration tests where practical: settings patch and queue control validate bounds and origins.
- `bun run verify`; targeted `TEST_DATABASE=1` integration tests; desktop and phone browser inspection; `vibepod-preview doctor asset-studio`.

## 9. Risk and Impact Analysis

- High: `loadRuntimeSettings` feeds both API and Eve; malformed migration or per-request read failures can block production. Normalize deterministically and keep missing-file defaults.
- High: queue gating surrounds the atomic claim. Check pause/concurrency immediately before claim, while allowing claimed work to complete and preserving shutdown/cancellation paths.
- High: model/price changes must never mutate recovered sessions. Resolve configuration only for new records; saved database/session snapshots win.
- Medium: diagnostics must be useful without leaking URLs, credentials, executable paths, data roots, PIDs, or raw provider errors.
- Medium: `src/routes/projects/$projectId/index.tsx` contains staged user work. Apply only defaults-related hunks and do not stage/commit unrelated paths.
- Compatibility: Python Blender reads the same JSON directly and needs legacy plus nested support.

## 10. Files Expected to Change

| File | Symbols | Reason |
| ---- | ------- | ------ |
| `src/lib/contracts.ts` | runtime settings schemas | Versioned validation and patch contract |
| `src/lib/runtime-settings.ts` | defaults/resolvers | Safe effective defaults |
| `src/lib/runtime-settings.server.ts` | load/save/update | Migration and durable partial updates |
| `src/lib/worker-control.server.ts` (new) | heartbeat/control helpers | Queue coordination and diagnostics |
| `src/lib/diagnostics.server.ts` (new) | diagnostics snapshot | Redacted health reporting |
| `scripts/worker.ts` | lane | Pause, dynamic concurrency, heartbeat |
| `src/modules/ai/**` | role/profile/pricing consumers | New-work configuration with snapshots |
| `src/lib/collection.server.ts`, `src/modules/model-analysis/index.server.ts`, `blender/server.py` | timeout consumers | Complete timeout coverage |
| `src/lib/api.server.ts` | api | Settings patch, queue, agents, diagnostics |
| `src/routes/admin/**` | route pages/components/styles | Operations UX and diagnostics page |
| `src/routes/projects/$projectId/index.tsx` | ProjectPage | Generation defaults |
| tests and docs | focused coverage/content | Regression protection and operator guidance |

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: "Implement comprehensive safe admin runtime configuration, queue controls, agent profiles, pricing, timeout coverage, generation defaults, and diagnostics."
  acceptance_criteria:
    - "Admin remains one primary nav item with responsive sidebar subnavigation."
    - "Editable validated settings cover all requested safe fields and affect new work only."
    - "Pause stops new claims; concurrency changes dynamically; active jobs finish."
    - "Diagnostics are useful and redact secrets/paths."
    - "All tests, build, browser checks, preview doctor, commit, and push succeed."
  evidence_provenance:
    schema_version: 2
    head_commit: "e06b584b3d38495fd4dc3bdc85a8380529262b8a"
    generated_plan_path: "docs/plans/2026-10-01-gitnexus-plan-admin-runtime-controls.md"
    global_dirty_digest:
      algorithm: "sha256"
      canonicalization: "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records"
      value: "9dc62ab33f4449332da4ff67567f2056c987437a8669be41352f77772f895b2d"
    cited_path_manifest:
      - { path: "design.md", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:e8c5eb0c9ea8e1b57848cacde3b4c931662e36f12c2d54bc8eb17fc2d44a11ca", index_digest: "sha256:e8c5eb0c9ea8e1b57848cacde3b4c931662e36f12c2d54bc8eb17fc2d44a11ca", worktree_digest: "sha256:e8c5eb0c9ea8e1b57848cacde3b4c931662e36f12c2d54bc8eb17fc2d44a11ca", untracked_digest: absent }
      - { path: "package.json", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:8d194b8c52453f09924bc9925100e397205b50e7e88b8414e5a78744a5ae0605", index_digest: "sha256:8d194b8c52453f09924bc9925100e397205b50e7e88b8414e5a78744a5ae0605", worktree_digest: "sha256:8d194b8c52453f09924bc9925100e397205b50e7e88b8414e5a78744a5ae0605", untracked_digest: absent }
      - { path: "scripts/worker.ts", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:56ba6b710eeb611e5551db80fe86f8aeb80b9d5f82a6cab376d2ec0d22ed8ac4", index_digest: "sha256:56ba6b710eeb611e5551db80fe86f8aeb80b9d5f82a6cab376d2ec0d22ed8ac4", worktree_digest: "sha256:56ba6b710eeb611e5551db80fe86f8aeb80b9d5f82a6cab376d2ec0d22ed8ac4", untracked_digest: absent }
      - { path: "src/lib/api.server.ts", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:30e8d1f5dce7e083560fcfbc477ca93c16a2157fba9c4d823a4a205ca92770f1", index_digest: "sha256:30e8d1f5dce7e083560fcfbc477ca93c16a2157fba9c4d823a4a205ca92770f1", worktree_digest: "sha256:30e8d1f5dce7e083560fcfbc477ca93c16a2157fba9c4d823a4a205ca92770f1", untracked_digest: absent }
      - { path: "src/lib/contracts.ts", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:bca4024e48be199a2acbe9dd8a9c27beb3c5e987a9a39c50d8d5231f50939a7d", index_digest: "sha256:bca4024e48be199a2acbe9dd8a9c27beb3c5e987a9a39c50d8d5231f50939a7d", worktree_digest: "sha256:bca4024e48be199a2acbe9dd8a9c27beb3c5e987a9a39c50d8d5231f50939a7d", untracked_digest: absent }
      - { path: "src/lib/runtime-settings.server.ts", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:7820d3e317cdf202297af9421b7ac945afcf5b726f450f6f72b49d9778a970b5", index_digest: "sha256:7820d3e317cdf202297af9421b7ac945afcf5b726f450f6f72b49d9778a970b5", worktree_digest: "sha256:7820d3e317cdf202297af9421b7ac945afcf5b726f450f6f72b49d9778a970b5", untracked_digest: absent }
      - { path: "src/lib/runtime-settings.ts", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:7665b6c5ad523fbf552681ee631ef3e841e55385fe665a4a4dfccbb0851e6390", index_digest: "sha256:7665b6c5ad523fbf552681ee631ef3e841e55385fe665a4a4dfccbb0851e6390", worktree_digest: "sha256:7665b6c5ad523fbf552681ee631ef3e841e55385fe665a4a4dfccbb0851e6390", untracked_digest: absent }
      - { path: "src/modules/ai/index.server.ts", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:560874e3908afc0fa095426801badd4a78c1403bd42efbe43efbdb550c81276b", index_digest: "sha256:560874e3908afc0fa095426801badd4a78c1403bd42efbe43efbdb550c81276b", worktree_digest: "sha256:560874e3908afc0fa095426801badd4a78c1403bd42efbe43efbdb550c81276b", untracked_digest: absent }
      - { path: "src/modules/ai/internal/accounting.server.ts", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:5af5488b57e73c6cd44d8f76deba84ea969e3366008f6f3688222d5597646eeb", index_digest: "sha256:5af5488b57e73c6cd44d8f76deba84ea969e3366008f6f3688222d5597646eeb", worktree_digest: "sha256:5af5488b57e73c6cd44d8f76deba84ea969e3366008f6f3688222d5597646eeb", untracked_digest: absent }
      - { path: "src/modules/ai/roles.ts", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:8190d365dc93334d12a8d4ad591044c7251fcce00374dcb9c55e8632ae3ced22", index_digest: "sha256:8190d365dc93334d12a8d4ad591044c7251fcce00374dcb9c55e8632ae3ced22", worktree_digest: "sha256:8190d365dc93334d12a8d4ad591044c7251fcce00374dcb9c55e8632ae3ced22", untracked_digest: absent }
      - { path: "src/routes/admin/settings/-components/settings-form.tsx", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:1f678b5bfd042456f5efa37f1041dac21748502c909d3c5329c9839c4d5da11e", index_digest: "sha256:1f678b5bfd042456f5efa37f1041dac21748502c909d3c5329c9839c4d5da11e", worktree_digest: "sha256:1f678b5bfd042456f5efa37f1041dac21748502c909d3c5329c9839c4d5da11e", untracked_digest: absent }
      - { path: "src/routes/projects/$projectId/index.tsx", object_kind: { head: regular, index: regular, worktree: regular, untracked: absent }, state: staged, rename_from: null, rename_to: null, head_digest: "sha256:191d29aa8a2dd9174ab423ee8d838449c0a17a032f4c0bcb7e5c5df17234bc32", index_digest: "sha256:458e007a8bb666e491e93aa58180cfd44971dda0a2c515e138e687aafd6ec1c4", worktree_digest: "sha256:458e007a8bb666e491e93aa58180cfd44971dda0a2c515e138e687aafd6ec1c4", untracked_digest: absent }
  primary_symbols:
    - { symbol: "loadRuntimeSettings", file: "src/lib/runtime-settings.server.ts", lines: "12-22", role: "Compatibility and effective configuration boundary" }
    - { symbol: "lane", file: "scripts/worker.ts", lines: "45-95", role: "Claim gating and active-job lifecycle" }
    - { symbol: "runRole", file: "src/modules/ai/index.server.ts", lines: "22-39", role: "AI engine dispatch" }
    - { symbol: "pricingSnapshot", file: "src/modules/ai/internal/accounting.server.ts", lines: "6-33", role: "Per-run rate snapshot" }
    - { symbol: "api", file: "src/lib/api.server.ts", lines: "57-727", role: "Admin and project HTTP behavior" }
  related_symbols:
    - { symbol: "runtimeSettingsSchema", relationship: "validates", relevance: "All persisted and API settings" }
    - { symbol: "agent", relationship: "calls loadRuntimeSettings/pricingSnapshot", relevance: "New/resumed Eve sessions" }
    - { symbol: "draftBrief", relationship: "calls pricingSnapshot", relevance: "TanStack one-shot runs" }
    - { symbol: "imageRequest", relationship: "separate image rate/timeout path", relevance: "Image roles" }
    - { symbol: "ProjectPage", relationship: "consumes generation defaults", relevance: "New batch form" }
  execution_path:
    - "Admin write passes origin validation, patch validation, atomic persistence, and returns normalized effective settings."
    - "Worker reloads control before claim; eligible lanes atomically claim; active jobs finish independently; heartbeat records redacted state."
    - "New AI request resolves profile and rates, creates a run/session snapshot, then adapter executes; resumed work uses saved values."
    - "Diagnostics probes dependencies independently and returns a redacted aggregate."
  pdg_constraints:
    - description: "Pause/concurrency must control only future claims."
      affected_statements: ["scripts/worker.ts:46-58"]
      implementation_consequence: "Check before SQL claim; never stop an already claimed job on admin changes."
    - description: "Eve remains durable-context-only."
      affected_statements: ["src/modules/ai/index.server.ts:28-34"]
      implementation_consequence: "Do not make engine or result schema configurable."
  architectural_patterns:
    - { pattern: "Atomic JSON persistence", example_location: "src/lib/runtime-settings.server.ts:24", usage_guidance: "Preserve temporary-write plus rename and mode 0600." }
    - { pattern: "Route-private admin UI", example_location: "src/routes/admin/settings/-components/settings-form.tsx", usage_guidance: "Keep new page UI under the owning route's -components folder." }
  files_to_modify:
    - { file: "src/lib/contracts.ts", symbols: ["runtimeSettingsSchema"], intended_change: "Versioned safe settings and patch validation" }
    - { file: "src/lib/runtime-settings.server.ts", symbols: ["loadRuntimeSettings", "saveRuntimeSettings"], intended_change: "Compatibility and partial updates" }
    - { file: "scripts/worker.ts", symbols: ["lane"], intended_change: "Dynamic queue control and heartbeat" }
    - { file: "src/modules/ai/**", symbols: ["runRole", "agent", "draftBrief", "imageRequest", "pricingSnapshot"], intended_change: "Resolve new-work profiles/rates/timeouts" }
    - { file: "src/lib/api.server.ts", symbols: ["api"], intended_change: "Admin operations endpoints" }
    - { file: "src/routes/admin/**", symbols: ["admin pages"], intended_change: "Editable operations UI and diagnostics" }
    - { file: "src/routes/projects/$projectId/index.tsx", symbols: ["ProjectPage"], intended_change: "Generation defaults without disturbing staged TriangleCount work" }
  tests:
    - { file: "src/lib/runtime-settings.server.test.ts", scenarios: ["legacy flat settings -> load -> normalized v2", "partial update -> unrelated settings retained", "invalid values -> rejected before write"] }
    - { file: "src/lib/worker-control.test.ts", scenarios: ["paused -> no lane claims", "lane index beyond concurrency -> no claim", "eligible active setting -> claim allowed"] }
    - { file: "src/lib/diagnostics.server.test.ts", scenarios: ["probe failure -> degraded component only", "snapshot -> no credential, URL, PID, executable or filesystem path"] }
    - { file: "src/modules/ai/internal/accounting.test.ts", scenarios: ["configured model rates -> new snapshot", "saved rates remain unchanged after config edit"] }
  verification_commands:
    - "bun run verify"
    - "TEST_DATABASE=1 bun test src/lib/api.integration.test.ts src/lib/queue.integration.test.ts"
    - "vibepod-preview doctor asset-studio"
  risks:
    - "Critical shared settings loader and AI snapshot semantics"
    - "Queue claim concurrency ordering"
    - "Redaction of diagnostics"
    - "Concurrent staged changes in project route"
  assumptions:
    - "The worker can poll a local atomic settings file once per idle loop; verify with tests and preview service logs."
    - "A reachability probe can treat any HTTP response from the Blender MCP endpoint as service availability without returning endpoint details."
  open_questions: []
  avoid:
    - "Do not expose secrets, database/provider credentials, executable/filesystem paths, recovery leases, pipeline versions, or live storage switching."
    - "Do not make prompt contents, execution engine, schemas, product maxima, or pipeline behavior editable."
    - "Do not change existing run/session snapshots or cancel active jobs when queue controls change."
    - "Do not hand-edit src/routeTree.gen.ts or stage unrelated TriangleCount/model-page work."
```

## 12. Assumptions and Open Questions

- [assumed] Polling the small local settings file once per idle worker loop is acceptable; verify idle behavior and service logs.
- [assumed] Blender availability can be represented by bounded HTTP reachability without exposing its endpoint.
- No blocking product questions remain. Engine selection, prompt editing, product limits, credentials, paths, storage switching, leases, and pipeline versions are explicitly deferred/out of scope.

## 13. Definition of Done

- Legacy and new settings files load safely; all requested values are validated and editable in their appropriate admin pages.
- Queue pause/concurrency changes apply without restart and never interrupt active work; heartbeat status is visible.
- Every fixed timeout named in the request consumes effective configuration.
- New AI/image work uses configured profiles and pricing while historical/recovered snapshots remain unchanged.
- Project generation dialog uses configured defaults while API bounds remain unchanged.
- Diagnostics display database, worker, Eve, Blender, storage, effective configuration, and recent failure summaries without sensitive/internal values.
- Admin UI follows the design guide at desktop and phone widths with loading, error, disabled, and empty states.
- Required tests, build, preview doctor, GitNexus final check, commit, and push complete without including unrelated workspace changes.
