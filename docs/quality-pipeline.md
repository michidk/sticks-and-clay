# Visual targets and staged quality review

New model attempts use `model-quality:4`:

1. Generate a per-asset visual target through the Image API (`prompts/models/visual-target.md`). The approved batch design, specific model brief and uploaded references are inputs. Log the request, reference keys, image, usage and estimated cost separately from Eve sessions.
2. Run the durable production planner. It freezes the named parts, material slots, texture targets, UV strategy and export checks for this attempt. The plan is passed to every builder and judge and is reused on resume.
3. Show the target as the card cover until a 3D render exists. Label it as a concept. The Visual target tab keeps it accessible; historical versions retain their own target key.
4. Build and photograph separate blockout and shape-refinement passes using temporary matte colors. With judging enabled, a fresh judge compares the seven photographs with the target, user references and the production plan. Major silhouette, construction and transition defects block surface work.
5. Retry geometry within the configured stage limit. A pass advances to materials. If geometry exhausts its limit, the pipeline still builds, textures and reviews materials, then finishes with issues.
6. Build the requested final materials, then polish and photograph the result. Textured assets require purposeful generated base-color images and appropriate normal maps. Color markings normally belong on continuous surfaces, rather than raised patch geometry. Run the surface review/revision loop with the same per-stage limit.
7. Archive every export and review. Collection thumbnails use the latest render. New v4 jobs retain blockout, refinement, materials and polish with photography when judge rounds is zero; only judging is disabled.

A review passes only when the judge reports `passed: true` and lists no major or critical findings. The application enforces this for both geometry and surface reviews, even when the model returns a contradictory pass or high score. Raw AI responses remain in run history; version feedback records the effective verdict.

The configured round count is a maximum per stage. Two rounds allow up to four judge calls and six builds, including the initial blockout and material passes. Early passes skip unused refinements. Saved v1–v3 jobs retain their original graph and inputs. New attempts keep prior attempts, images, sessions, feedback and usage history.

The text design wins if the generated image contradicts it. Triangle counts are informational only. Historical approved snapshots remain in history; the pipeline no longer configures or enforces polygon limits.

## Recovery and accounting

Eve Responses calls explicitly use `store: false`: the SDK serializes local assistant content and function calls instead of server-side item references. Reasoning history is omitted for gateway compatibility; function `call_id` identity remains intact. A regression test exercises the actual provider serialization.

Image requests are one-shot calls, not Eve sessions. Completed requests reuse their receipt/run; interrupted requests are recorded as failed and retried separately. Cancellation stops the image subprocess. Image API token usage is stored verbatim and priced from the code-owned entry for the exact model, including separate text-input, image-input and image-output token classes. Unknown models remain unavailable, never a fabricated zero-dollar cost.

The renderer puts its ground plane at Z=0, matching normalized asset contact. PostgreSQL uses one pool per process across development reloads.

## Configuration

- Roles/models: `src/modules/ai/roles.ts` (builder and judge default to Astra with high effort; runtime overrides apply to new runs).
- Prompt directory: `prompts/`.
- Graph: `src/modules/pipelines/index.ts`.
- Asset handlers: `src/lib/model-pipeline.server.ts`, coordinated by `src/lib/pipeline.server.ts`.
- Shared image executor: `src/modules/ai/internal/image.server.ts`, accessed through the public AI module.

On graceful worker shutdown, interrupted jobs return to `queued` with their existing checkpoints; cancelling/cancelled jobs are never reactivated. Abrupt process termination leaves running jobs for startup adoption. Legacy queued collection jobs containing only geometry previews settle with issues without publishing them as final scenes.

The local service supervisor sets Eve's inline ownership lease to 60 seconds (SDK default: 860) for this single-process runtime, preventing long apparent stalls after restart. Operators can override it for other deployments. New Eve sessions have no automatic lifetime expiry; individual client request timeouts remain bounded. Existing sessions retain their original lifetime policy.


## Independent photography

New attempts insert a resumable Eve photographer after every build, including zero-review builds. Builder renders remain diagnostic only. The photographer uses constrained `photograph_asset` camera/exposure controls to import the immutable GLB into a fresh Blender scene, render front, rear, detail, left, right, top, and bottom at 1024², and inspect each through `view_render`. It cannot edit the asset with its capability. The role defaults to Astra with medium effort and appears in Admin → Agents; inputs, outputs, sessions, tokens and estimated costs use normal run history.

Only validated photographs are published as latest thumbnails/gallery images and sent to the judge. Each set is archived under `photographs/<runId>` with source GLB and image hashes, linked from the builder iteration and photographer result. Failed photography blocks judging and completion; resume retains its session and completed builds. Older v1/v2 jobs retain their saved graph. Historical versions retain their own photographs; generated visual targets remain the fallback until the first photo set is published.

When a generation batch settles, a separate `project-photo` job snapshots the latest published GLB for every model across the project, including textured models that completed with geometry issues. The same photographer arranges these at their relative scales and renders three collection views. The most recently completed, validated project photograph becomes the project-card thumbnail; input references remain the fallback. Earlier photo sets and asset manifests remain visible in Activity & cost. Queue supports cancellation and failed-photography resume. `POST /api/projects/<id>/photograph` can refresh an existing project's cover without regenerating assets.


## Required modeling passes (v4)

New attempts perform separate persisted blockout, shape refinement, materials and polish builds. Each exports an immutable version and receives photography. Refinement and polish receive the preceding photographs as well as the previous Blender source, target and original references. Geometry review happens only after refinement, and surface review only after polish. Failed reviews repeat that stage's refinement within the chosen review limit; exhausted geometry review records an issue but still runs the materials and surface review stages. Saved v1–v3 jobs resume their original graph.

`prompts/models/modeling-pass.md` defines concrete work and a before/after summary for each pass; `prompts/models/modeling-review.md` gives that summary to the judge as claims to verify against the actual photographs. These are additional build sessions, so elapsed time and estimated cost increase. No time, tool-call or polygon quota substitutes for visible quality. Each run retains normal history, usage accounting and resume identity.

## Debug view

The model page's **Debug** tab (a collapsible section on graphic pages) shows how a version was built, one card per agent run: role, modeling pass, duration, cost, and condensed steps. Steps are the agent's narration, its reasoning headings, each tool call in plain words (script read, write, edit and Blender run, with triangle and material counts or the error line), the renders it inspected as thumbnails, and the run's result. `GET /api/models/<id>/trace` builds this from the saved Eve events in `src/lib/build-trace.ts`; full prompts, outputs and raw events stay in Activity.

## Visual target approval

New 3D generation pauses after the visual target. Approve & build on the asset card or model review page queues the existing job; Revise visual target uses feedback and the previous image to generate another target for approval. Each image run remains in Activity. Waiting models release their worker slot and remain waiting across restarts. Approval is tied to the exact current image, so an outdated browser cannot approve a newer revision.

Skip visual mock in the model idea dialog builds directly from the approved design and brief without an image-generation call. The choice is saved with the idea and batch. Graphics keep their one-shot generation flow. Existing batches retain automatic progression through their saved pipeline; the migration does not introduce a new approval requirement into ongoing work.

## SVG recognition review

An SVG project's intent (`icon`, `logo` or `illustration`, set in the Design reference tab or with `update_workshop`) is frozen into each new batch; batches saved without one are icons. It selects the builder and judge guides (`prompts/svg/builder-*.md`, `judge-*.md`), the rendered evidence, the collection-review sizes and whether the reader runs. Logos render full size, 64px and 16px light plus 64px and 16px dark, and are judged as marks (one-color reproduction, negative space) without the reader; illustrations render full size and 64px only, are judged on composition and finish, and skip the reader; icons get everything below. The planner returns a shared `iconContract` only for icons.

For icons, new SVG review rounds first send the current full-size, 64px, 24px and 16px light-background PNGs plus 64px, 24px and 16px dark-background PNGs to `svg-reader` without the asset name or brief. The SVG judge then receives that reading alongside measurements and the approved design. Ambiguity is evidence for a visible finding, not an automatic exact-name rejection. This adds one accounted call per review round; zero rounds skips both reader and judge. Saved legacy judge checkpoints replay without a new reading, and saved reader calls resume through their own step checkpoint. Human acceptance remains separate. See the [source audit and pilot workflow](icon-workflow-research.md).
