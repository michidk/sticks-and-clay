# Visual targets and staged quality review

New model attempts use `model-quality:2`:

1. Generate a per-asset visual target with the Codex imagegen skill (`prompts/visual-target.md`). The approved batch design, specific model brief and uploaded references are inputs. Log the request, reference keys, image, usage and estimated cost separately from Eve sessions.
2. Show the target as the card cover until a 3D render exists. Label it as a concept. The Visual target tab keeps it accessible; historical versions retain their own target key.
3. With judging enabled, build finished geometry using temporary matte colors. A fresh judge compares all three actual renders with the target and user references. Major silhouette, construction and transition defects block surface work.
4. Retry geometry within the configured stage limit. A pass advances to materials; exhaustion finishes with issues and explicitly states that surface work was withheld.
5. Build the requested final materials. Textured assets require purposeful generated base-color images and appropriate normal maps. Color markings normally belong on continuous surfaces, rather than raised patch geometry. Run the surface review/revision loop with the same per-stage limit.
6. Archive every export and review. Collection thumbnails use the latest render. Zero judge rounds retains a single complete builder run with self-review before texturing.

The configured round count is a maximum **per stage**, so two rounds allow up to four build/review pairs (two geometry and two surface). Early passes skip unused rounds. Existing `model-review:1` jobs retain their original build/review-pair behavior and saved inputs. New attempts keep prior attempts, images, sessions, feedback and usage history.

The text design wins if the generated image contradicts it. Numeric triangle limits apply only when explicitly present in the approved design or brief; historical approved snapshots are never silently rewritten.

## Recovery and accounting

Eve Responses calls explicitly use `store: false`: the SDK serializes local assistant content and function calls instead of server-side item references. Reasoning history is omitted for gateway compatibility; function `call_id` identity remains intact. A regression test exercises the actual provider serialization.

Image requests are one-shot calls, not Eve sessions. Completed requests reuse their receipt/run; interrupted requests are recorded as failed and retried separately. Cancellation stops the image subprocess. Image API token usage is stored verbatim and priced only when image-token rates are configured; missing rates remain unavailable, never a fabricated zero-dollar cost.

The renderer puts its ground plane at Z=0, matching normalized asset contact. PostgreSQL uses one pool per process across development reloads.

## Configuration

- Roles/models: `src/modules/ai/roles.ts` (builder and judge: Astra, medium).
- Prompt directory: `/home/vibepod/workspaces/asset-studio/prompts`.
- Graph: `src/modules/pipelines/index.ts`.
- Asset handlers: `src/lib/pipeline.server.ts`.
- Shared image executor: `src/modules/ai/internal/image.server.ts`, accessed through the public AI module.

On graceful worker shutdown, interrupted jobs return to `queued` with their existing checkpoints; cancelling/cancelled jobs are never reactivated. Abrupt process termination leaves running jobs for startup adoption. Legacy queued collection jobs containing only geometry previews settle with issues without publishing them as final scenes.

The local service supervisor sets Eve's inline ownership lease to 60 seconds (SDK default: 860) for this single-process runtime, preventing long apparent stalls after restart. Operators can override it for other deployments. New Eve sessions have no automatic lifetime expiry; individual client request timeouts remain bounded. Existing sessions retain their original lifetime policy.
