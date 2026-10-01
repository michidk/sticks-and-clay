# Visual targets and staged quality review

New model attempts use `model-quality:2`:

1. Generate a per-asset visual target with the Codex imagegen skill (`prompts/visual-target.md`). The approved batch design, specific model brief and uploaded references are inputs. Log the request, reference keys, image, usage and estimated cost separately from Eve sessions.
2. Show the target as the card cover until a 3D render exists. Label it as a concept. The Visual target tab keeps it accessible; historical versions retain their own target key.
3. With judging enabled, build finished geometry using temporary matte colors. A fresh judge compares all three actual renders with the target and user references. Major silhouette, construction and transition defects block surface work.
4. Retry geometry within the configured stage limit. A pass advances to materials; exhaustion finishes with issues and explicitly states that surface work was withheld.
5. Build the requested final materials. Textured assets require purposeful generated base-color images and appropriate normal maps. Color markings normally belong on continuous surfaces, rather than raised patch geometry. Run the surface review/revision loop with the same per-stage limit.
6. Archive every export and review. Collection thumbnails use the latest render. New v4 jobs retain blockout, refinement, materials and polish with photography when judge rounds is zero; only judging is disabled.

The configured round count is a maximum **per stage**, so two rounds allow up to four build/review pairs (two geometry and two surface). Early passes skip unused rounds. Existing `model-review:1` jobs retain their original build/review-pair behavior and saved inputs. New attempts keep prior attempts, images, sessions, feedback and usage history.

The text design wins if the generated image contradicts it. Triangle counts are informational only. Historical approved snapshots remain in history; the pipeline no longer configures or enforces polygon limits.

## Recovery and accounting

Eve Responses calls explicitly use `store: false`: the SDK serializes local assistant content and function calls instead of server-side item references. Reasoning history is omitted for gateway compatibility; function `call_id` identity remains intact. A regression test exercises the actual provider serialization.

Image requests are one-shot calls, not Eve sessions. Completed requests reuse their receipt/run; interrupted requests are recorded as failed and retried separately. Cancellation stops the image subprocess. Image API token usage is stored verbatim and priced from the code-owned entry for the exact model, including separate text-input, image-input and image-output token classes. Unknown models remain unavailable, never a fabricated zero-dollar cost.

The renderer puts its ground plane at Z=0, matching normalized asset contact. PostgreSQL uses one pool per process across development reloads.

## Configuration

- Roles/models: `src/modules/ai/roles.ts` (builder and judge: Astra, medium).
- Prompt directory: `/home/vibepod/workspaces/asset-studio/prompts`.
- Graph: `src/modules/pipelines/index.ts`.
- Asset handlers: `src/lib/pipeline.server.ts`.
- Shared image executor: `src/modules/ai/internal/image.server.ts`, accessed through the public AI module.

On graceful worker shutdown, interrupted jobs return to `queued` with their existing checkpoints; cancelling/cancelled jobs are never reactivated. Abrupt process termination leaves running jobs for startup adoption. Legacy queued collection jobs containing only geometry previews settle with issues without publishing them as final scenes.

The local service supervisor sets Eve's inline ownership lease to 60 seconds (SDK default: 860) for this single-process runtime, preventing long apparent stalls after restart. Operators can override it for other deployments. New Eve sessions have no automatic lifetime expiry; individual client request timeouts remain bounded. Existing sessions retain their original lifetime policy.


## Independent photography (v3)

New attempts insert a resumable Eve photographer after every build, including zero-review builds. Builder renders remain diagnostic only. The photographer uses constrained `photograph_asset` camera/exposure controls to import the immutable GLB into a fresh Blender scene, render front/rear/detail at 1024², and inspect each through `view_render`. It cannot edit the asset with its capability. The role uses Astra with medium effort and appears in Admin → Agents; inputs, outputs, sessions, tokens and estimated costs use normal run history.

Only validated photographs are published as latest thumbnails/gallery images and sent to the judge. Each set is archived under `photographs/<runId>` with source GLB and image hashes, linked from the builder iteration and photographer result. Failed photography blocks judging and completion; resume retains its session and completed builds. Older v1/v2 jobs retain their saved graph. Historical versions retain their own photographs; generated visual targets remain the fallback until the first photo set is published.

When a generation batch settles, a separate `project-photo` job snapshots the latest published GLB for every model across the project, including geometry previews where final materials are pending. The same photographer arranges these at their relative scales and renders three collection views. The most recently completed, validated project photograph becomes the project-card thumbnail; input references remain the fallback. Earlier photo sets and asset manifests remain visible in Activity & cost. Queue supports cancellation and failed-photography resume. `POST /api/projects/<id>/photograph` can refresh an existing project's cover without regenerating assets.


## Required modeling passes (v4)

New attempts perform separate persisted blockout, shape refinement, materials and polish builds. Each exports an immutable version and receives photography. Refinement and polish receive the preceding photographs as well as the previous Blender source, target and original references. Geometry review happens only after refinement, and surface review only after polish. Failed reviews repeat that stage's refinement within the chosen review limit; exhausted geometry review still withholds materials. Saved v1–v3 jobs resume their original graph.

`prompts/modeling-pass.md` defines concrete work and a before/after summary for each pass; `prompts/modeling-review.md` gives that summary to the judge as claims to verify against the actual photographs. These are additional build sessions, so elapsed time and estimated cost increase. No time, tool-call or polygon quota substitutes for visible quality. Each run retains normal history, usage accounting and resume identity.
