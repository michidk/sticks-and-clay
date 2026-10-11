# Asset workshop roadmap

Status: implemented feature delivery on 2026-10-11, with the remaining acceptance and consolidation work listed below. See [verification and limitations](docs/asset-workshop-verification.md). Checked items describe delivered code; milestone exit statements remain acceptance criteria, not claims of live-agent quality.

Goal: improve PBR generation and sprites rendered from 3D while reusing the current execution and review infrastructure. Refactor the boundaries needed by the next feature, then deliver that feature. Avoid a repository-wide rewrite before users see improvements.

Detailed requirements, concrete prompt wording, and reference implementation findings are retained in [implementation notes](docs/asset-workshop-roadmap-notes.md). This roadmap supersedes their original phase ordering.

## Delivery order and dependencies

1. **M0 — baseline and evidence fixes.** Establish compatibility and correct current inspection mistakes.
2. **M1 — shared contracts and neutral services.** Separate materials, sprites, subprocesses, and bundles.
3. **M2 — reliable execution and publication.** Coordinate render resources and recover artifact sets consistently.
4. **M3 — shared review definitions and prompt assembly.** Enable new reviewed workflows without changing historical runs.
5. **M4 — material toolkit refactor and richer recipes.** Deliver better manual materials.
6. **M5 — reviewed material generation and continuation.** Add scripted construction, visual repair, and version history.
7. **M6 — sprite renderer refactor and better controls.** Deliver timing, framing, palettes, clips, playback, and diagnostic evidence.
8. **M7 — model handler extraction and sprite-first generation.** Target final pixels during construction and review.
9. **M8 — interactive material preview and model assignment.** Inspect and export explicit derived versions.
10. **M9 — material reuse and delivery packages.** Cache stable builds and package runtime assets.
11. **M10 — measured calibration.** Add evidence-backed calibration after construction and evaluation are stable.

Dependencies: M1 follows M0. M2, M3, and M4 each follow M1. M5 requires M2–M4. M6 requires M2 and can ship independently of M4–M5. M7 requires M3 and M6. M8 requires M4–M5. M9 follows M5, M6, and M8. M10 requires M4–M5 and M8. These are dependency relationships, not a requirement to run concurrent agents.

Each milestone is a reviewable change or a small sequence of PRs. Keep behavior-preserving extractions separate from feature changes where practical. Schedule estimates should follow the first live evaluation of render and repair costs.

## M0 — establish the baseline and fix evidence mistakes

**When:** before shared runtime or prompt changes. **Refactor:** minimal; do not move modules yet.

Evidence: quick model builds publish only front/rear/detail/metrics, while `view_render("sprites")` reads the final location. Final views lack the same stale-build warning as previews. The material planner is told to inspect images it never receives.

- [x] Reuse existing fixtures to characterize model pipeline versions 1–4, disabled judging, early pass, exhaustion, final export, resume, and failure after a successful preview.
- [x] Make quick sprite inspection select the actual quick build; label retained historical and stale final images correctly.
- [x] Remove unsupported rendered-review instructions from the planner and resolve contradictory sprite examples in `prompts/references/game-interfaces.md`.
- [x] Record representative renders for six recipes and static/animated sprites as the visual baseline.

**Exit:** correct evidence labels and reproducible baseline fixtures; ordinary model generation and archived versions keep their existing behavior.

## M1 — shared contracts and misplaced responsibilities

**When:** before material iteration, more sprite options, shared history UI, or a new build result format.

Evidence: `materials.server.ts` mixes HTTP actions, job serialization, subprocess execution, ZIP creation, and material orchestration. `workshop-actions.server.ts` imports those generic functions for sprite jobs. `materials.ts` owns sprite settings too. Both UI panels consume `any[]` and infer file roles from filenames.

- [x] Move `runExportProcess`, `exportBundle`, and `savedExport` responsibilities into neutral build/artifact services. Keep public URLs unchanged and feature HTTP actions thin.
- [x] Separate material and sprite contracts, with compatibility re-exports as needed. Add discriminated, versioned API results and validated artifact metadata.
- [x] Define a build receipt with kind/mode/build identity, input/script/parameter/toolkit hashes, toolchain, timings, status, typed failure, checks, and artifacts with roles/labels/dimensions.
- [x] Keep material units/channels and sprite clips/directions/times/pivots typed independently. Avoid one giant object of optional fields.
- [x] Reuse `source-bundle.server.ts` and the storage facade. Add legacy receipt adapters; do not rewrite old archives.

**Suggested boundary:** a small `src/modules/asset-builds/` public interface for contracts, validation, execution, and publication, with material/sprite-specific handlers outside it. Naming can change; dependency direction is the requirement.

**Exit:** sprite jobs no longer depend on the material feature for generic runtime services; new APIs/UI consume validated results instead of unchecked casts and filename guesses.

## M2 — execution, resource limits, and publication

**When:** after M1; before iterative material builds, expanded sprite rendering, and final-artifact review.

Evidence: `blender/server.py` mixes authorization, subprocesses, candidate workspaces, publication, and routing. Its semaphore covers builder runs, but its photography path, TypeScript presentation jobs, and standalone launchers bypass that gate. Material builds write directly into output directories. Timeouts and cancellation are duplicated.

- [x] Extract process supervision and candidate-output handling from the Python server; retain capability checks and HTTP/MCP as adapters.
- [x] Use one host-level Blender resource gate across launch paths. Acquire once; preserve separate workspace locks. Offline runners must not depend on PostgreSQL.
- [x] Standardize cancellation, owned-child cleanup, wait versus execution time, overall deadlines, log retention, and bounded progress events.
- [x] Give every kind candidate directories, receipt validation, last-good retention, and publication through a committed manifest/pointer. Publish storage objects before exposing a completed database version.
- [x] Classify script, validation, dependency, timeout/resource, cancelled, and runner errors. Script repair gets the actual traceback; operational failures do not trigger artistic rewrites.
- [x] Extend inspection to receipt-backed artifact IDs, crops, and paged sheets. Preserve scoped access, immutable vision references, actual image transport, and current-build hashes.
- [x] Pin runner protocol/helper versions explicitly. Record compatibility upgrades rather than silently changing an in-progress job's runtime.

**Exit:** different entry points obey the same render limit; waiting work cancels; orphan cleanup leaves unrelated processes alone; partial builds never become completed artifacts; failed builds retain labelled historical previews; relocated bundles run independently.

## M3 — review definitions and prompt assembly

**When:** after M1; before M5 and M7. Splitting every job handler is not a prerequisite.

Evidence: `runPipeline` already provides generic traversal, but node metadata is restricted to geometry/surface passes. Eve assembles and snapshots references; TanStack reads only the main prompt. Guide selection partly relies on request keywords.

- [x] Separate traversal from model-specific definitions. Add typed extensible metadata and a reusable bounded review definition; preserve compatibility exports and legacy definitions.
- [x] Share instruction-bundle assembly across adapters and pass explicit output-target/capability context. Preserve their distinct replay and accounting semantics.
- [x] Define request snapshots versus run instructions: resumed sessions keep saved bundles; retries/new attempts follow an explicit snapshot policy.
- [x] Add a shared review envelope for exact current/previous artifacts, references, script/parameters, technical evidence, and structured findings. Keep asset-specific rubrics.
- [x] Bound code repair, builder self-review, judge rounds, and final verification separately and in total. Do not multiply nested loops accidentally.
- [x] Add validated checkpoint accessors for new workflows while retaining historical keys. Checkpoint related state together; serialize updates per job before introducing concurrent handlers, since the current helper writes the whole checkpoint object.

**Exit:** both adapters receive relevant guides, material review can use shared traversal, and legacy model gates, mandatory passes, recovery, and usage totals remain unchanged.

## M4 — material toolkit refactor and better manual recipes

**When:** after M1; before agents author composition scripts in M5 or calibration modifies results in M10.

Evidence: `blender/materials/materialkit.py` combines defaults, random fields, every recipe, physical derivation, validation, PNG/JSON export, and review rendering. Additional layers should not deepen this coupling.

- [x] Separate parameter/physical-unit handling, periodic primitives, result/channel contracts, recipes, validation, and export/review rendering. Retain a small `materialkit` facade for scripts.
- [x] Distinguish immutable source parameters from effective quick-render settings. Use stable feature identities/seeds in physical coordinates across resolutions.
- [x] Add shared layer masks and only the primitives required by the six recipes. Couple height, color, roughness, and metallic response by construction.
- [x] Improve gravel distributions/burial/fines; wood boards/knots/grain; brick mortar/edges/variation; paint chips/scratches/streaks; sand ripples; stone fractures; bounded moisture/dirt modifiers.
- [x] Fix zero-wear exposure, physical AO sampling radius, resolution-dependent feature inflation, and unresolved-feature reporting. Preserve map conventions and 16-bit height.
- [x] Add tested composition examples against the stable facade and package every required helper in pinned/offline bundles.

**Exit:** manual generation improves visibly and physically; feature/channel relationships remain coherent across resolutions; older bundles rebuild with their pinned toolkit.

## M5 — reviewed materials and continuation

**When:** after M2–M4. **Refactor now:** persistent material identity, not the whole database schema.

Evidence: materials are currently jobs plus JSON strings in checkpoints; history returns the latest 40 jobs. This lacks an independent material/revision identity and parent/review relationships. Collection examples currently resolve only builder/graphic runs.

- [x] Add additive material/version persistence for immutable script/recipe, parent, artifacts, review outcome, and associated jobs/runs. Jobs remain execution state. Provide legacy projections for existing completed material jobs.
- [x] Snapshot selected same-kind references/examples at creation; extend collection guidance without treating unrelated model run IDs as material examples.
- [x] Keep manual generation local. Add scripted construction, quick preview, bounded runtime repair, independent visual review, and revision through the shared framework.
- [x] Implement feature-to-layer/evidence requirements and the draft prompts in the notes alongside their real toolkit APIs. Supply previous scripts and images for continuation.
- [x] Review final-resolution output before approval; distinguish approved, completed with issues, unreviewed, failed, and cancelled.
- [x] Add typed history/continuation controls. Extract shared job polling/cancellation when the material and sprite panels both need it; keep their content-specific views separate.

**Exit:** a multi-feature material can be visually repaired, resumed without duplicate completed paid steps, continued from a saved version, and rebuilt offline. Live examples substantiate quality claims.

## M6 — sprite rendering, controls, and playback

**When:** after M2, independently of material expansion/calibration. **Refactor first:** the sprite renderer's stages.

Evidence: `blender/assetkit/sprites.py` mixes sampling, camera/lights, render loops, assembly, pixel processing, and metadata. Clip selection uses imported NLA names but the UI accepts free text. Outline colors can exceed the palette budget.

- [x] Separate clip/timeline selection, framing, frame rendering, pixel processing, assembly, review, and metadata behind one facade.
- [x] Normalize saved-GLB clip identity and explicitly map it to imported actions. Define loop/one-shot time semantics once for rendering, UI, metadata, and tests.
- [x] Add clip dropdown, elevation, zoom, padding, stable anchor/pivot, and actual frame counts. Fit all poses together and avoid duplicate loop endpoints.
- [x] Enforce the effective palette including outlines and report actual colors. Preserve hard alpha in pixel mode.
- [x] Add native-size playback, directions/frame stepping, integer zoom, backgrounds, silhouette/grayscale, labelled motion/loop sheets, and checks on every delivered cell.
- [x] Export individual frames and typed metadata while preserving existing sheet layout. Include helpers in offline bundles.

**Exit:** correct clip/timing, stable framing, strict palettes, responsive playback, and unchanged source GLB, verified with real animated exports.

## M7 — model workflow extraction and sprite-first generation

**When:** after M3 and M6. This is the point to refactor the large model handler.

Evidence: `pipeline.server.ts` combines design, planning, graphics, and an extensive model branch with snapshots, target creation, capabilities, builders, photography, judging, archiving, progress, and finalization. Adding sprite-target conditionals throughout it would complicate recovery.

- [x] Extract the model handler with explicit context and typed iteration state; separate input preparation, stage handlers, and finalization. Leave the worker dispatcher and unrelated handlers behaviorally unchanged.
- [x] Add typed archived-model results at touched `versions.server.ts` and workshop boundaries. Reuse existing GLB cleanup/handover modules.
- [x] Add explicit sprite-target settings to approved batch/job snapshots and pass them through builder, renderer, judge, and validation.
- [x] Resolve material-policy precedence: permit intentional flat colors for sprites, while preserving explicitly requested textured-GLB requirements.
- [x] Judge exact sprite output during geometry/surface development with final-pixel criteria, required model checks, and immutable version history.

**Exit:** sprite briefs affect construction and judging; ordinary model generation and saved versions preserve semantics. Verify the extraction before adding new behavior.

## M8 — material preview and model assignment

**When:** after M4–M5. **Refactor before assignment:** viewer resource ownership, not every viewer feature.

Evidence: `src/components/model-viewer/index.tsx` combines toolbar, scene, cameras, model loading, and navigation. GLBs loaded with `useGLTF` may be shared; overrides must not mutate another viewer's cached materials.

- [x] Extract only lighting and texture/material lifecycle needed by a dedicated material viewer. Retain existing camera/navigation behavior.
- [x] Add tiled plane/sphere, adjustable lighting, channel inspection, and version comparison with correct color spaces and height units.
- [x] Own/clone preview material bindings; dispose owned resources without disposing shared GLB resources. Check UV suitability and select assignment slots explicitly.
- [x] Save assignments/exported GLBs as derived versions with model/material dependencies. Preserve archived originals.
- [x] Add opposing-light evidence sheets and WebGL-independent static previews/downloads.

**Exit:** multiple viewers show independent assignments, UV limitations are explicit, and derived exports retain dependencies/provenance.

## M9 — reuse and delivery packages

**When:** after M5, M6, M8. Cache only after the input/result contracts stabilize.

- [x] Cache material builds by normalized parameters, script, toolkit/dependencies/calibration, mode, and resolution. Verify hashes; populate atomically; bound retention. A cache is never the only saved copy.
- [x] Bind reused material sets through the configured Python environment without requiring material dependencies inside Blender.
- [x] Add lightweight delivery ZIPs separately from reproducible source bundles; derive content and import instructions from validated receipts.
- [x] Measure bundle memory/time before replacing the buffered ZIP writer. Streaming/compression is follow-up optimization if real workloads justify it.
- [x] Add optional animated previews after authoritative frames/timings are reliable. Engine importers wait for a selected target engine.

**Exit:** correct reuse/invalidation, corruption recovery, cache-free relocated rebuilds, and documented delivery contents.

## M10 — measured calibration and quality evaluation

**When:** after M4–M5 and M8. Keep it independent of basic generation usability.

- [x] Isolate measurements/calibration as pure stages separate from construction/export; report before/after statistics and version identity.
- [x] Build a small licensed reference corpus with source hashes, known physical scale, material class, preprocessing, and reproducible measurements.
- [x] Calibrate supported classes only, preserve region boundaries, and disable calibration by default for stylized workflows. Mark unsupported classes uncalibrated.
- [x] Bundle exact targets. Compare visually and numerically without presenting statistical similarity as proof of photorealism.
- [x] Evaluate current/proposed prompts on fixed briefs with matched seeds/references/budgets and recorded model/toolkit versions; measure feature coverage, regressions, repair cost, runtime, and uncertainty.

**Exit:** optional, evidence-backed calibration and recorded examples supporting the material/sprite quality claims.

## Refactors to defer or avoid

- **Whole API router rewrite:** extract touched feature routes as needed; `api.server.ts` size alone should not delay delivery.
- **All legacy checkpoint/result migrations:** use validated adapters. Add material identity at M5; retain historical model/run records and keys.
- **New workflow engine:** extend `runPipeline` in M3; no plugin framework, dynamic graph editor, or provider-specific replacement is needed.
- **Provider/accounting rewrite:** share instruction assembly while keeping Eve replay and TanStack one-shot semantics specialized.
- **Repository-wide removal of `any`:** type touched receipt/API/archive boundaries; leave generated routes and unrelated screens outside scope.
- **Universal viewer or UI framework:** extract real shared consumers at M5/M8, not abstractions for hypothetical future kinds.
- **Additional asset modes, general geometry/physics repair, or a large recipe catalog:** outside this roadmap. Expand recipes after representative quality evaluations.

## Verification and migration policy

- Preserve approved snapshots, recorded instructions, historical pipeline versions, meaningful source identity, and original files.
- Separate refactor verification from feature verification. Use focused regression tests for each extraction, then the repository checks appropriate to changed code.
- Runtime/recovery changes require subprocess cancellation, interrupted publication, PostgreSQL replay, and accounting checks. Render changes require actual Python/Blender outputs and relocated offline rebuilds.
- UI changes require desktop/phone inspection, keyboard use, loading/error/history states, and overflow checks.
- Run `bun run verify` for application work and relevant database/Python/Blender checks; rebuild Eve when its instructions/tools change. Documentation-only edits need content/link/whitespace checks.
- Update milestone status and PR scope after each delivery. Keep third-party product names out of authored files/PR text. The implementation notes contain detailed prompt drafts and evaluation cases.

## Remaining acceptance and consolidation

The six matched-budget material prompt trials are recorded in [the evaluation report](docs/material-prompt-evaluation.md). They identified API-contract ambiguity, insufficient channel evidence and a revision regression; they do not establish that the full prompt is superior.

**Eve sandbox acceptance:** compilation succeeds, but full sandbox prewarming still needs access to its container image registry.

Publication consolidation is delivered: current builds use immutable generations and an atomic pointer, with recoverable compatibility filenames. Inspection/archive readers resolve one committed generation. Runtime and publication recovery tests pass on both Windows and Linux, including cancelling a slot waiter without stopping the slot owner. Offline model rebuilds stage outputs and retain the previous successful GLB after a failed edit.

Material history currently displays the most recent 40 jobs, with independent immutable material/version identities saved in PostgreSQL. Pagination across all revisions is a later usability extension. Bundle instrumentation records input bytes, elapsed time and before/after RSS; it is not a peak-memory benchmark. Further streaming work needs representative large bundles.
