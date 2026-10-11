# Asset workshop implementation notes and research

This document retains detailed requirements, draft prompt wording, and the pipeline/tool audit. [The roadmap](../plan.md) is authoritative for delivery order, prerequisite refactors, and release gates. Phase numbers below organize the original research; they are not the implementation sequence.

Status: implementation plan. The current material and sprite foundation is already on the feature branch; the work below remains to be implemented.

Prompt/code audit: 2026-10-11. Findings below come from the installed reference application's generation guides, material construction/calibration modules, sprite renderer, and readiness checks, compared with this repository. Public-site access was unavailable. Proposed prompt text is independently written for this application's tools and contracts.

## Goal and scope

Improve procedural PBR materials and sprites rendered from 3D, using the existing agent execution, durable queue, review pipeline, and reproducible source bundles. Reuse the current 3D build/review machinery wherever its behavior applies.

This work does not add direct 2D pixel drawing, particle effects, a separate model-generation service, or a replacement for MCP. The agent should produce editable construction scripts and judge actual output. PBR maps continue to be constructed locally rather than generated through an image API.

## What already exists

- `src/modules/pipelines/index.ts` provides provider-independent graph traversal, bounded review definitions, conditional transitions, and cancellation hooks.
- The model pipeline already builds, photographs, judges, and repairs assets. Its versioned definitions preserve legacy recovery and geometry-before-surface gates.
- `src/modules/ai` centralizes roles, model selection, image transport, execution history, and usage accounting.
- Materials have six seeded recipes, physical units, channel maps, static review sheets, durable jobs, history, and offline bundles. Their current AI role selects parameters once; it does not inspect output or revise scripts.
- Sprite exports use saved GLBs, orthographic directions, animation samples, a shared palette, transparency, outlines, history, and offline bundles. Builders can already request sprite output and inspect it.

The main architectural gap is a reusable build/render/review definition and artifact contract. The traversal engine itself does not need replacing.

## Decisions after evaluating the suggestions

1. Generalize review definitions and artifact handoff, not all asset-specific behavior. Keep modeling, material construction, rendering, and delivery in dedicated handlers. Graphics can adopt the shared contract later when an actual iterative workflow needs it.
2. Preserve the current four-pass model workflow and legacy definitions. A material loop must not accidentally change model review counts, approval gates, checkpoint identity, or cost accounting.
3. Improve the existing six material recipes before adding a large catalog. Composition helpers provide more useful flexibility than many shallow presets.
4. Make sprite-first generation an explicit output target within 3D projects. Reuse model generation and its history instead of creating a disconnected project type or service.
5. Separate technical validity from visual approval. Numeric checks can catch errors and aid review; they cannot establish realism or good pixel art by themselves.
6. Treat scan calibration as an evidence-backed, opt-in finishing stage. Heuristic physical presets must be labelled as presets. Do not invent scan measurements or force realistic targets onto stylized materials.
7. Apply PBR maps to models in a reversible preview first. Persisted material replacement needs explicit assignment and suitable UVs; it must produce a new artifact rather than overwrite an archived model.
8. Budget the existing builder self-review separately from independent judge rounds, with an overall render/call limit. Do not multiply several nested 2–4-round loops across mandatory model passes.
9. Final approval must reference final-resolution artifacts. A reduced quick preview can guide construction but cannot establish fine material detail, the final palette, or unsampled sprite directions.

## Phase 1: extend the shared review framework

Implement the P0 runner/tool work in the pipeline and tools audit below alongside this phase; material iteration depends on its artifact and error contracts.

- [ ] Introduce a reusable bounded build → render → review definition using `runPipeline`. Support mandatory preparation passes, early approval, maximum rounds, and a final unreviewed build when judging is disabled.
- [ ] Keep existing model pipeline versions and dispatch unchanged. Reuse the new definition only where identical semantics can be demonstrated; do not rewrite legacy checkpoint keys.
- [ ] Define an asset-neutral review envelope: approved brief/design snapshot, references, previous result, current script/parameters, exact rendered artifacts, technical report, and structured findings.
- [ ] Use stable pipeline/version/step identities for repeated roles. Handlers own checkpointed output paths, completed-result reuse, artifact publication, and idempotent finalization.
- [ ] Preserve distinct outcomes: approved, completed with issues, completed without review, technical failure, and cancellation. Exhausting rounds must never imply approval.
- [ ] Record each script revision, render, review, model/effort snapshot, and usage record. Resume must reuse completed work and retain the correct preceding artifacts.
- [ ] Register material roles and authored prompts through the public AI module. Do not call provider adapters directly.
- [ ] Share prompt-bundle assembly across Eve and TanStack execution. The TanStack adapter currently reads only the main role prompt, so registering reference guides alone would not deliver them. Snapshot the complete assembled instructions and output contract; preserve saved sessions on resume.
- [ ] Add explicit output-target and capability context to role inputs and instruction selection. Keyword matching is insufficient to distinguish a sprite delivery from a model that merely mentions sprites.

Primary files: `src/modules/pipelines/index.ts`, `src/modules/pipelines/pipelines.test.ts`, `src/modules/ai/roles.ts`, `src/lib/pipeline.server.ts`, and material handlers.

Acceptance: a material workflow uses the same traversal machinery as models; cancellation, early pass, exhaustion, disabled judging, and checkpoint replay work without changing saved model behavior.

## Phase 2: scripted material generation and iteration

- [ ] Retain manual parameter generation as a fast local operation with no AI call. Make reviewed generation from a brief a separate, clearly described action with a configurable round limit.
- [ ] Have a material builder author an editable `asset.py` using pinned composition helpers. Use validated structured output for script text/notes initially; add an interactive tool session only if evaluation demonstrates a need.
- [ ] Build quick previews with the fixed runner, then send the actual review image and technical report to the material judge. Feed concrete findings and the preceding script into the next builder pass.
- [ ] Separate runtime repair from artistic review: supply the actual traceback for a bounded code repair, without spending an artistic verdict on an image that was never produced. Attach script/parameter hashes and resolution to every reviewed artifact.
- [ ] Run and inspect final-resolution output before approval. The current quick runner clamps size to 128; label that evidence accordingly. Make physical feature placement stable across preview resolutions, and provide a full-resolution crop when subpixel behavior matters.
- [ ] Keep the user-owned seed, resolution, and approved context stable. Report unresolved physical-scale requests instead of silently inflating features.
- [ ] Archive each iteration separately. Retain the last successful preview if a later script fails; a failed execution remains visible and is not reported as a successful build.
- [ ] Add material continuation from a selected saved version, carrying its script, parameters, prior preview, and immutable parent identity. Forking or changing a seed creates a new saved result.
- [ ] Include all required toolkit files, inputs, revisions, final script, parameters, reviews, dependencies, and manifests in the offline bundle. Run the bundle without an agent or application service.
- [ ] Show recorded review outcomes and linked revisions in material history; keep manual generation visibly unreviewed.

Primary files: `src/lib/materials.server.ts`, `src/lib/materials.ts`, `prompts/`, `blender/materials/render.py`, and the project material panel.

Acceptance: an unsuccessful material can be revised from its actual rendered output, resume after interruption, and rebuild from the downloaded bundle.

## Phase 3: richer material construction and physical correctness

- [ ] Add deterministic, tileable composition primitives for particles, substrate, region masks, cracks, chips, scratches, streaks, and deposits. Derive color, roughness, metallic regions, and height from shared feature masks.
- [ ] Improve gravel with bounded size distributions, partial burial, varied shapes, and fine substrate in gaps. Handle unresolved particles explicitly and expose density caps.
- [ ] Improve wood with boards, knots, variable grain, and localized wear; improve brick with individual unit variation, shaped mortar, edge damage, and deposits.
- [ ] Improve painted metal with layered paint/exposed metal, scratches, chips, and directional streaks. Zero wear must produce no exposed metal; wear must have an explainable material effect.
- [ ] Improve sand and stone using coherent ripple variation and connected fractures. Keep simulation complexity bounded; full hydraulic erosion is unnecessary for this iteration.
- [ ] Add optional moisture and deposited dirt as material modifiers with consistent map changes. Expose a small set of meaningful controls instead of every low-level parameter.
- [ ] Express AO sampling radius in physical units, with resolution-aware sampling. Preserve physical normal derivatives and explicit height encoding units.
- [ ] Report requested versus resolved feature sizes, sampling limits, normal lengths/slopes, finite ranges, seam evidence, and per-region channel consistency. Preserve OpenGL +Y normals, unlit sRGB albedo, linear data maps, and 16-bit height.

Primary files: `blender/materials/materialkit.py`, additional material helper modules, `src/lib/materials.ts`, and material prompts.

Acceptance: features and wear affect corresponding maps consistently; changing resolution preserves physical scale rather than changing the intended material; seeded builds remain reproducible.

## Phase 4: material inspection and calibration

- [ ] Add an interactive material viewer using the existing Three.js stack: plane/sphere, tile repetition, rotatable lighting, normal strength, roughness inspection, and controlled height displacement where suitable.
- [ ] Configure texture color spaces, normal conventions, and filtering explicitly. Show loading/error states and keep downloads available without WebGL.
- [ ] Add reversible application to a selected saved model and comparison between material versions. Warn when the model lacks suitable UVs; do not silently invent UVs or overwrite archived GLBs.
- [ ] Provide optional export of an explicitly assigned model as a new artifact with map dependencies and source/provenance. Original model and material history remain intact.
- [ ] Add descriptive measurements for mean linear albedo, color variation, multiscale detail, roughness, and normal slope. Show measurements separately from artistic feedback.
- [ ] Build a small licensed CC0 reference corpus with material class, physical scale, source, license, preprocessing, and measurement provenance. Collect or verify physical scale before using a sample as a calibration target.
- [ ] Implement optional class calibration against measured ranges. Preserve semantic region boundaries, intrinsic base color, seed, and construction scale. Expose before/after evidence; disable calibration by default for stylized workflows.
- [ ] Save dataset/calibration versions and all required targets in bundles. If evidence is insufficient for a material class, report it as uncalibrated.

Acceptance: the user can inspect and compare maps under changing light, preview them on a model, and distinguish measured calibration from heuristic presets. Calibration ships only with reproducible source data and provenance.

## Phase 5: sprite controls, delivery, and review

- [ ] Discover available animation clips from the selected saved GLB and expose a dropdown with an explicit active-animation option. Do not require users to know imported NLA names.
- [ ] Add camera elevation, bounded zoom, padding, and a stable ground/center anchor. Fit all sampled poses together to avoid per-frame camera jitter; record pivots in export metadata.
- [ ] Support explicit loop versus one-shot sampling. Loop sampling excludes the repeated endpoint; one-shot sampling retains it. Preserve distinct poses and report actual delivered frame counts.
- [ ] Enforce the requested palette and total color budget including outlines. Snap or reserve outline colors consistently and report the effective palette.
- [ ] Add a native-size animation player with direction selection, speed, pause, and frame stepping. Include integer zoom, dark/light backgrounds, silhouette, grayscale, and palette views.
- [ ] Generate review sheets and technical checks for dimensions, hard alpha in pixel mode, palette membership, border clipping, stray pixels, value separation, and animation consistency. Craft heuristics create warnings, not automatic artistic rejection.
- [ ] Label each cell with direction, source frame/time, and native resolution. Preserve our rows=frames/columns=directions contract. Fit actual 1x crops plus integer-enlarged views into vision inputs so image resizing cannot silently replace native-size evidence.
- [ ] Export individual frames alongside the sheet and JSON, with stable names, direction labels, pivots, timings, and clip/source identity. Keep engine-specific importers outside the initial scope.
- [ ] Pin renderer/helper versions and parameters in offline bundles. Preserve source GLB bytes and acknowledge device/toolchain limits on image-byte reproducibility.

Primary files: `src/lib/materials.ts`, presentation job handlers, `blender/sprite_render.py`, `blender/assetkit/sprites.py`, pixel helpers, and the sprite export component.

Acceptance: a looping animated asset has no duplicate endpoint, every sprite respects its palette budget, playback matches exported metadata, and exports rebuild offline without changing the source GLB.

## Phase 6: sprite-first model generation

- [ ] Add an explicit sprite output target to 3D generation with snapshotted cell size, camera, directions, palette, and animation requirements.
- [ ] Teach builders to prioritize the final pixel silhouette: readable proportions, thicker thin parts, distinct color regions, restrained surface detail, and visible distinguishing features.
- [ ] Render a bounded subset of directions/frames for quick development, then validate the complete final sheet. Keep final camera and palette constraints stable across rounds.
- [ ] Give the existing geometry and surface judges sprite-specific evidence and criteria. Retain technical geometry checks, but judge visual success at the requested sprite resolution rather than only in beauty renders.
- [ ] Resolve the main builder/judge prompts' mandatory image-texture requirements for sprite targets. Permit intentional flat color regions and matte materials when they satisfy the delivery; explicit textured-GLB requirements still apply when requested. Wire this policy into validation as well as prose.
- [ ] Remove contradictory sprite examples in `references/game-interfaces.md`: one currently requests pixel processing, while another omits `pixel=True` and therefore selects different rendering behavior. Keep one capability-checked example.
- [ ] Route repairs through existing model iterations and archive the exact sprite evidence reviewed. Include collection guidance, approved examples, and the preceding sprite result where relevant.

Acceptance: a sprite-first request changes model construction and review behavior while preserving ordinary 3D generation, version history, and model exports.

## Explicit prompt improvements

Implement these as short role-specific guides with concrete input fields. Avoid appending every rule to the already long general builder prompt. Changes that require missing toolkit APIs or new evidence must ship with those capabilities, not ahead of them.

### 1. Turn the brief into observable requirements

The useful reference pattern is mapping named features to construction and visible evidence. Our planner already maps adjectives to scalar parameters, but cannot express several independent features or check whether they survived rendering.

Add to the future material builder input and structured result:

> Before writing the script, list the requested base material and each distinguishing feature. For each feature record its physical size, construction layer or region, affected channels, and the preview where it should be visible. Preserve a specifically requested base. Mark unsupported or unresolved features explicitly. A clean default recipe is insufficient when it omits a requested feature.

Store a compact requirement list alongside the script, not free-form internal reasoning. The judge receives the original brief and checks the list for omissions instead of trusting the builder's list as exhaustive.

### 2. Teach causal material construction

Add to a new `prompts/references/material-construction.md`, backed by the implemented toolkit signatures:

> Construct the substrate and larger features first, then smaller deposits and wear. Use shared region masks to make height, base color, roughness, and metallic response describe the same surface. Explain why a region changes: exposed metal beneath chipped paint, grit lodged between stones, or eroded wood along the grain. Use seeded fields to vary an identified process. Independent noise in every channel does not establish a material.

Include two small, runnable examples authored for our toolkit: partially buried gravel over fines; paint over metal with chips and scratches. Examples must show units, stable seeds, channel coupling, and the final return contract. Test their execution. Do not include API names from a different toolkit.

### 3. Make physical scale and visibility actionable

Add to both material construction and review guidance:

> Compute feature pixels as featureMm / (tileMetres * 1000 / resolution). Distinguish resolved shapes from unresolved surface variation. Preserve physical size; do not enlarge grains merely to make them visible. For stylized exaggeration, follow the approved brief and record the choice. Evaluate fine detail in a crop at the actual output resolution, not an enlarged low-resolution draft.

Example acceptance fixture: 2 mm grit on a 1 m tile at 256 px occupies about 0.51 px. The agent should report unresolved grains and produce appropriate aggregate variation, rather than claim individually visible stones.

### 4. Give material judges a fixed evidence order

Create `prompts/material-judge.md` and its input template:

> First verify that the attached images belong to this script, seed, and build. Check required features and physical scale; then the unlit base-color crop; then height/normal/roughness/metallic relationships; then the repeated lit tile for seams and recognizable repetition. A matching average color or passing seam statistic does not prove the requested structure exists. Cite the image label and affected region for each finding. Recommend the construction change that would address it. Missing evidence is unknown, not verified.

Use a few prioritized findings, each with severity, requirement, image/cell label, observation, suggested correction, and verification view. Preserve the existing pass semantics. Avoid absolute claims such as photoscan quality based on calibrated statistics alone.

### 5. Make iteration preserve successful work

Add to material and sprite revision inputs:

> Compare the preceding result with the requested change. State which approved features must remain and which visible relationship should change. Edit the smallest coherent construction section that achieves the request. After rendering, check the changed feature and previously correct regions for regressions. Keep seed, camera, palette, and scale fixed unless the request changes them. Describe observed differences; do not report planned edits as verified improvements.

Supply actual previous images and script, not only textual feedback. Avoid imposing a universal 1.5–2x change for words such as larger: honor explicit dimensions and use an appropriate, measurable change for the context.

### 6. Establish sprite-specific prompt precedence

Create a dedicated sprite construction guide selected by the explicit output target, and update the main prompts so its material policy is authoritative for that target:

> The delivered sprite at the requested cell size is the visual acceptance target. Prioritize recognizable silhouette, separation of important parts, and distinct color regions after palette reduction. Where the approved style permits, widen details that disappear or flicker. Use matte color regions when sufficient; generate textures only when their contribution survives the final rendering. Do not add texture noise to satisfy the ordinary textured-model workflow. Keep useful 3D construction and animation intact.

Use roughness ranges as adjustable examples rather than universal requirements. Avoid prescribing big heads, saturated colors, or nonmetallic surfaces to every asset; those choices depend on the design.

### 7. Review sprites as a sequence and set of views

Add to sprite judge guidance and the builder's self-review checklist:

> Inspect native-size sprites before enlarged views. Identify the asset and action from its silhouette. Compare every delivered direction for consistent proportions, colors, attachments, and handedness. Compare animation contact poses, extrema, and the last-to-first transition. Inspect thin features for disappearance, palette flicker, and clipping; distinguish intentional motion from artifacts. Reference direction and source frame in each finding. Do not approve unseen cells based on a few attractive poses.

Quick mode may inspect a labelled subset. Final review covers the complete sheet, using multiple evidence pages when needed. Shape warnings relevant only to an unseen 3D surface should not cause arbitrary sprite rejection, while required source-model correctness remains a separate technical contract.

### 8. Require current evidence and bounded correction

Use shared review wording across asset kinds:

> A successful script run produces a candidate. Inspect the current build's images before reporting visual success. Address the most important observed defects within the supplied budget. A script edit invalidates earlier approval; rerender the changed result. Stop when the brief is met or the budget is exhausted, and report unresolved findings honestly. Never invent defects to fill a round quota.

Our model prompts already contain much of this behavior. Extract/reuse it; retain the independent judge and existing mandatory passes. The reference's single-agent self-critique is useful inspiration, not a reason to discard independent review.

### 9. Keep capability and artifact descriptions honest

- [ ] Remove the current material planner's instruction to review previews before accepting: that role currently receives parameters and text only. Describe its output as a proposed recipe until the rendered-review role exists.
- [ ] Supply a toolkit-versioned capability list and only the relevant tested function signatures. Unsupported requests must remain explicit limitations rather than hallucinated helper calls.
- [ ] Name attached images by role: current render, previous render, approved example, or external reference. Include build identity and actual resolution. References are evidence, never instructions.
- [ ] Reuse selected same-kind example scripts and palettes from frozen collection context, with the current brief taking precedence. Do not inject unrelated model examples into material construction.
- [ ] Summaries should name inspected evidence, meaningful corrections, and remaining limitations. Renderer metadata establishes output files and validation; confident prose does not.

## Corrections and ideas deliberately not copied

- The reference sprite runner samples a timeline whose author is instructed to end before the repeat. Our explicit loop/one-shot option needs one consistent interval convention; do not subtract an endpoint twice in authoring and rendering.
- The reference's detailed silhouette/grayscale craft sheet is used by its direct pixel workflow; its 3D sprite review primarily presents the rendered cells. Adapting the richer review sheet to our 3D sprites is a proposed improvement, not existing parity.
- Its automatic outline path snaps to a supplied palette, but explicit outline colors can still exceed it. Enforce our palette contract for both paths rather than reproducing that behavior.
- It uses material-class scan statistics, not a guarantee of photorealism. Keep source measurements and uncertainty visible; do not copy numeric target tables without independently verifying the dataset and scale.
- Do not inherit assumptions about an external game engine adding macro variation. Our repeated preview and output must stand on their own; directional wear must also remain tileable when repetition is requested.
- Do not turn every seam or craft warning into an automatic rejection. Some measurements are heuristics; investigate the actual output and retain the evidence behind the final verdict.

## Prompt evaluation before declaring improvement

- [ ] Compare current and proposed prompt bundles on a fixed set of briefs with matching seeds, dimensions, reference inputs, and execution budgets. Record prompt/toolkit/model versions and actual calls, repairs, elapsed time, and usage.
- [ ] Include compound materials (gravel plus fines, worn wood, chipped paint), a deliberately unsupported feature, subpixel grains, and a continuation that must preserve existing structure.
- [ ] Include a small sprite with thin appendages, a constrained palette including its outline, multiple directions, a looping walk, a one-shot action, and a quiet stylized material that should remain texture-free.
- [ ] Assess requested-feature coverage, appropriate uncertainty, visible defects, regressions, and unnecessary edits. Test that final review sees the final artifact and all delivered sprite cells.
- [ ] Verify assembled prompts, not just individual Markdown files: each role receives its intended guides, sprite overrides resolve mandatory-texture conflicts, TanStack receives references, and resumed runs retain their saved instructions.
- [ ] Use mocked responses for recovery/accounting tests and actual renders for image evidence. A small recorded live generation comparison is needed to establish prompt quality; string assertions alone are insufficient.

## Verification and completion

- [ ] Add meaningful regression tests for shared pipeline termination/replay, stable step identities, legacy model semantics, and material revision recovery.
- [ ] Test seeded material composition, zero wear, physical normal direction, AO/feature behavior across resolutions, tile wrapping, region/channel consistency, and calibration measurement provenance.
- [ ] Exercise a real animated GLB for clip selection, loop/one-shot sampling, stable framing/pivots, strict palette/outline budgets, and unchanged source hashes.
- [ ] Rebuild downloaded material and sprite bundles from relocated directories without the app, agent, or service dependency. Verify required helper files and manifests.
- [ ] Check actual rendered output across all six recipes and representative static/animated sprites. Use a small approved generation evaluation to assess prompt/repair quality; deterministic tests alone cannot establish artistic success.
- [ ] Inspect material controls/viewer and sprite playback in the collaborative browser at desktop and phone widths, including keyboard access, loading, failure, warnings, and history.
- [ ] Run `bun run verify`, relevant PostgreSQL integration tests, Python material tests, real Blender sprite tests, and the Eve rebuild when shared instructions/tools change.
- [ ] Update `docs/ai-architecture.md`, `docs/asset-workshop.md`, prompt documentation, and PR scope/validation. Keep third-party product names out of repository files and PR text.

Start with shared prompt assembly, explicit output-target contracts, and bounded review definitions. Develop the material composition API before writing executable examples against it; then integrate the scripted material loop. Sprite controls and review evidence can proceed independently, followed by sprite-first generation. Deliver interactive material inspection before the evidence-dependent calibration stage. Evaluate the new prompts on actual renders before expanding the recipe catalog. The work is complete only when the implemented behavior, recovery checks, offline rebuilds, and documented limitations are reviewable in the PR.

## Pipeline and tools audit

The installed reference's readable harness confirms a common runner for multiple asset kinds, quick/final execution, process-wide render locks, typed script-versus-harness failures, artifact manifests, local material caching, readiness reports, and derived export packages. Its application/controller is distributed as an executable; its internal provider routing, complete agent tool registration, job persistence, and finalization behavior cannot be established from the Python harness alone. Statements about agent permissions in its prompts are declared policy, not proof of controller enforcement. The runner describes agent-driven quick builds and server-driven final builds; the final server invocation remains outside the inspected source.

The following are adaptations worth implementing. Priorities account for capabilities already present here.

### P0: one render resource gate across entry points

Observed advantage: OS-backed render slots coordinate Blender processes across generations. Waiting time is recorded separately from execution time, and the runner records its Blender child for cleanup.

Our `blender/server.py` has a process-local semaphore and per-capability locks. The TypeScript sprite/presentation paths and standalone launchers start Blender separately, so that semaphore does not coordinate all entry points. The job queue's concurrency limit is useful but is a different resource limit.

- [ ] Introduce a shared host-level Blender slot mechanism used by model builds, photography, sprites, presentation jobs, and standalone runners launched on that host. Keep CPU material work under a separate bounded pool if profiling warrants it.
- [ ] Acquire the resource once at the outer launch boundary; prevent nested launcher/child acquisition from deadlocking. Preserve per-workspace serialization independently.
- [ ] Record waiting, preparing, running, validating, and publishing states. Cancellation must work while waiting. Track resource-wait and active-render time separately; retain an overall deadline rather than permitting unlimited waiting.
- [ ] Supervise children across cancellation, timeout, caller disconnect, and service restart. Verify process identity using executable, start time, and workspace ownership before terminating an orphan; a matching PID/process name alone is insufficient.
- [ ] Use cross-process tests with two different launch paths, cancellation during waiting, and a killed holder. Confirm the slot is released and unrelated Blender processes remain running.

### P0: a common build receipt and typed failure contract

Observed advantage: the reference runner returns a manifest containing asset kind, mode, files with roles/labels, stats, warnings, and success. It distinguishes asset-script errors from runner/infrastructure errors with separate exit codes.

Our model tools return `ok`, log tails, and metrics, while material/sprite handlers consume separate metadata formats and hard-coded file lists. This makes generic review and recovery harder than necessary.

- [ ] Define a versioned build receipt shared by all kinds: build ID, kind, mode, input/script/parameter/toolkit hashes, toolchain, timings, status, artifact records, technical checks, and failure details.
- [ ] Artifact records carry logical role, relative path, MIME type, label, checksum, dimensions, and relevant direction/frame or material-channel metadata. Keep our existing delivery filenames/layouts compatible.
- [ ] Classify failures as script, contract/validation, dependency/toolchain, resource/timeout, cancelled, or internal runner failure. Preserve the traceback/log artifact; return a concise actionable excerpt to the agent.
- [ ] Route script failures into bounded code repair. Route missing Blender/dependencies and resource failures into operational recovery, without asking the artist to repeatedly rewrite a correct script.
- [ ] Validate receipt schema and actual files before publication. Never trust a script-authored success flag as evidence that required artifacts exist and match the build.
- [ ] Provide compatibility adapters for legacy receipts and recorded jobs. Keep technical validity separate from the artistic verdict.

### P0: consistent candidate publication and evidence freshness

Observed advantage: the reference runner retains the last good quick build across a failed candidate. Our model server already builds in candidate directories and retains prior successful output; extend that behavior to materials and sprite presentation jobs rather than replacing it with the reference's clear-and-copy approach.

- [ ] Render every kind into a unique candidate directory. Validate and publish a completed artifact set together, using a committed manifest/pointer to prevent readers seeing a half-copied set.
- [ ] Retain last-good artifacts and label them historical when the current script/build fails. Store the current failure alongside the historical preview.
- [ ] Extend image inspection beyond the fixed `view_render` filename enum to receipt-backed artifact IDs, labelled crops, and paged sheets. Preserve scoped access, immutable vision image references, and actual image transport.
- [ ] Fix the existing quick sprite evidence gap: `run_saved_asset` publishes only metrics/front/rear/detail for quick builds, and `view_render("sprites")` reads the final location. Publish quick sprite artifacts explicitly and make inspection select the requested build/mode rather than potentially showing an old final sheet.
- [ ] Bind every viewed artifact to its actual build and script hash. Apply freshness checks to final views as well as `preview_*`; an edit must not leave a final image described as the current result.
- [ ] Test interrupted publication, failed script after a good preview, quick sprite inspection before any final export, and stale final inspection after an edit.

### P1: a small consistent authoring and inspection interface

Observed advantage: the reference presents one script, fixed parameters, one render command, and a known review artifact across kinds. Our native workspace tool already offers scoped read/write/edit/run, optimistic source hashes, and fixed runners; changing transport to generic shell tools provides no demonstrated benefit.

- [ ] Reuse the workspace protocol and build receipt across material and model handlers, while retaining separate Python/Blender implementations. A structured material builder can return script text to the same backend without requiring an interactive tool session.
- [ ] Add a bounded capability/reference lookup only if needed: installed toolkit version, supported operations, validated function signatures, and short runnable examples. Resolve these from pinned workspace support, not live mutable documentation.
- [ ] Preserve exact-match edits, stale-write detection, fixed parameters, and clean-process execution. Avoid introducing unrestricted file or shell tools merely to resemble another application's workflow.
- [ ] Keep inspection separate from execution and usable by read-only judges. Crops and sheet paging should reference the original artifact and report transformations.

### P1: deterministic finalization and useful progress

Observed advantage: the reference runner has a clear separation between cheap development renders and full final exports. Its logs expose render-slot waits and renderer progress, and the common manifest provides a result independent of agent prose.

- [ ] Let orchestration ensure the accepted script has a successful final build, complete technical checks, and final evidence. Reuse an already completed final build with matching inputs instead of rendering it twice.
- [ ] Snapshot finalization inputs and checkpoint packaging/publication so a service restart does not require another paid agent call.
- [ ] Stream bounded progress events and retain full logs as artifacts. Show actual milestones rather than percentages inferred from log volume.
- [ ] Treat missing or unreadable required review evidence as an incomplete review. Do not let a final summary substitute for the current receipt.
- [ ] For sprite/material paths use deterministic evidence rendering by default. Retain the existing independent photographer for ordinary models; evaluate any later simplification separately rather than changing the four-pass pipeline incidentally.

### P1: evidence that tests material response and motion

Observed advantage: the reference has proof-sheet utilities for opposing light directions and labelled motion samples, plus common readiness checks on delivered files. These provide more diagnostic information than one attractive render.

- [ ] Add a fixed-camera left-light/right-light material proof to the existing map/crop/tile review. It can reveal highlights or shadows baked into base color, but remains visual evidence rather than an automatic proof of correctness.
- [ ] Add labelled sprite motion strips for contact/extreme poses and loop transitions, preserving a common crop and anchor across frames. Reuse the same images in the player, judge input, and export history.
- [ ] Normalize readiness checks as named pass/warn/fail/unknown items with measurements, units, and evidence references. Unknown or unavailable must not become a pass.
- [ ] Run checks against delivered maps/sheets as well as source arrays or scenes. Use the same report in the UI and bundle; do not turn a summed readiness score into artistic approval.

### P1: reusable material results and a model binding bridge

Observed advantage: physical material results are cached by parameters/toolkit identity and can be created through an external Python process when Blender's Python lacks dependencies. The material toolkit also offers Blender-side application helpers.

- [ ] Introduce a content-addressed material build cache keyed by normalized parameters, script, toolkit/dependency/calibration versions, and mode/resolution. Use content hashes rather than file modification times.
- [ ] Validate hashes before a cache hit is accepted; populate entries atomically. Keep cache retention bounded and never use it as the sole archive of a saved version.
- [ ] Provide an explicit helper to bind an archived material set to selected model materials, including color spaces, physical tile scale, normal convention, and packed-channel interpretation.
- [ ] Reuse our configured Python environment for material construction rather than requiring SciPy inside Blender or searching arbitrary interpreters. Bundle the generated maps and construction inputs so offline rebuilds do not depend on a shared cache or external workspace.
- [ ] Test same-input reuse, invalidation after toolkit/calibration changes, corrupted entries, simultaneous requests, and a cache-free relocated rebuild.

### P2: delivery packages separate from source bundles

Observed advantage: derived exports package runtime assets, pivot/timing metadata, import instructions, and a report separately from editable construction source. Sprite exports can include individual frames and a convenience animated preview.

- [ ] Add a lightweight delivery ZIP for PBR maps plus channel/scale metadata and sprites plus sheet/frames/pivots/timings. Keep the existing reproducible source ZIP as a distinct download.
- [ ] Include point-filtering/transparency guidance for pixel sprites and sRGB/linear/normal/height conventions for materials. Derive instructions from actual export metadata.
- [ ] Optionally include a GIF or APNG preview after native playback and frame export work; it is a convenience preview, not the authoritative palette/timing artifact.
- [ ] Add engine-specific importers only when a concrete target engine is selected. Do not import unrelated collider, rig, particle, or engine-specific behavior into this scoped work.

### Existing strengths to preserve and unverified claims

Our durable PostgreSQL job history, independent reviews, staged model gates, archived instruction snapshots, source hashes, stale-edit protection, and provider usage accounting already cover important parts of the workflow. The inspected reference harness does not establish that its controller does these better, nor that replacing our tools with MCP or shell tools would improve results.

Do not copy automatic geometry repair broadly: source edits can change intentional openings, seams, animation, or stylized construction. Existing intent-aware checks should report evidence; any new repair needs a scoped operation and before/after verification. Do not copy readiness labels suggesting perfection, PID-only stale-process termination, or metadata-only cache invalidation.

Recommended order: shared receipt/errors and current-build evidence first; cross-entry-point render coordination alongside them; then the material/sprite review integrations, diagnostic sheets, and material reuse. Delivery conveniences follow verified core behavior. This extends the earlier phase plan without adding unrelated asset modes.
