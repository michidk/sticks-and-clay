# Asset workshop verification

Implementation date: 2026-10-11. The delivered scope is procedural PBR materials and sprites rendered from 3D, plus shared execution/review infrastructure. No particle pipeline or raster image-generation provider was added.

## Delivered behavior

- Six refactored, physically scaled material recipes, coherent layer composition, moisture/dirt modifiers, 16-bit height, opposing-light evidence, and optional measured wood/brick response calibration.
- Scripted material construction with bounded runtime repair, independent final-resolution judging, immutable versions, continuation, same-kind examples, review outcomes and replay-safe checkpoints. Manual recipes remain local Python work.
- Shared review traversal, instruction assembly and image evidence ordering. Legacy model v1–v4 definitions remain intact; zero judge rounds still preserve the four v4 construction passes.
- Stable animation-index selection, loop/one-shot sampling, framing and pivot controls, strict shared palettes, individual sprite frames, diagnostic sheets and interactive playback. Sprite-target model generation passes the target through construction, rendering and judging.
- Interactive material inspection and comparison, isolated material bindings, UV/slot checks, derived GLB assignment with source/map hashes, source bundles, delivery packages and bounded verified material caching.
- Shared host render slots, process ownership/cleanup, retained logs, typed failures, artifact receipts and candidate publication for material/sprite exports. All current entry points use committed generations and recoverable compatibility filenames; older pinned bundles retain their original protocol.

## Checks performed

Environment: Windows, Bun 1.4.3, Python 3.13, Blender 5.2.1. PostgreSQL tests used a dedicated local test database and data directory; migrations 0012 and 0013 were generated, inspected and applied there.

- `bun run verify`: application typecheck, unit tests, production build and Eve typecheck pass. The full suite with database tests enabled passed 116 tests with seven environment-dependent skips before the additional evidence-order regression was added; that regression also passes separately.
- Native model-analysis integration: four tests pass, including UV binding and interrupted native intersection analysis.
- Python runtime/workspace/cancellation/material-quality suite: 17 tests pass. A Windows descendant cleanup race found during testing was fixed by assigning suspended processes to an owned Job Object and waiting for descendant termination.
- Real Blender sprite tests: two pass, including selected animation index, different frames, source preservation, strict palette, hard alpha, individual frames and loop sampling.
- Real Blender model workflow: quick/final generation, retained output after a script failure, and relocated source rebuild pass. An initial combined invocation incorrectly loaded a Blender-only test through ordinary Python; the sprite suite was rerun successfully inside Blender.
- Real Blender material assignment: passes, including exported normal/roughness/metallic/AO bindings and preserved source.
- Real photographer MCP candidate publication: passes, including a generated photography receipt and removal of the candidate directory.
- Desktop and 390px phone inspection: material controls/preview, saved history, sprite dialog, direction/frame controls and playback inspected. No page-width overflow in the new panels.
- Eve compilation succeeds with `--skip-sandbox-prewarm`. Normal prewarming fails because access to `ghcr.io/vercel/eve:0.71.0` is denied; full sandbox startup was not verified.

## Fixed-seed recipe comparison

`scripts/evaluate-materials.py` rendered all six recipes with seeds 17 and 91 at 128px and an 80mm feature size. The baseline was the repository's pre-change material toolkit, exported as a standalone Python module. Both toolkits produced 12 samples, for 24 local renders total.

| Measurement | Baseline | Updated |
| --- | ---: | ---: |
| Median render time | 0.406 s | 0.461 s |
| Total validation warnings | 8 | 3 |

These are small local measurements, not a production performance benchmark or proof of artistic quality. The maximum wood seam heuristic worsened even though aggregate warning count fell. Review at final resolution before making quality claims. The evaluator writes parameter snapshots, statistics and output paths so another machine can repeat the comparison.

Calibration targets record source URLs, license, physical scale, file hashes, preprocessing and measurements. `scripts/measure-materials.py` reproduces the measurements from the referenced public assets; downloaded image blobs are not committed. Calibration is disabled by default and unsupported classes are explicitly uncalibrated.

## Remaining acceptance

The first live builder/judge attempt had no configured API credential. A provider is now available; matched-budget trials remain to be run. Cached paid-step replay and real local render/repair tests verify orchestration, not model quality. Matched-budget prompt A/B results, repair costs and feature coverage remain unmeasured.

The runtime and publication suites pass on Windows and Linux Docker (eight tests per platform), including waiting cancellation, owned descendants, failed commit rollback, interrupted alias recovery and corrupt-candidate rejection. Bundle telemetry records before/after RSS, not peak memory; no streaming rewrite is justified by this small fixture workload. The remaining roadmap items are listed explicitly in `plan.md`.

## Applying the change

Apply the additive migrations with `bun run db:migrate`, then rebuild/restart Eve and the worker. Existing source bundles keep their pinned helpers. Newly prepared bundles include the expanded material/sprite/runtime modules and recorded toolchain information. Offline rebuilding does not require PostgreSQL or an agent credential; matching toolchain versions is required for reproducibility, and byte-identical GPU renders across machines are not promised.

## Publication follow-up verification

The database-enabled suite passes 118 tests with seven environment-dependent skips. The new supervised publication integration verifies the Python/TypeScript boundary and source-bundle exclusions. Vision tests verify that partial compatibility-file writes cannot change the committed evidence, and reject tampered artifacts. Actual Blender assignment, sprites and photographer publication pass. The model workflow additionally verifies a relocated offline rebuild followed by a failing edit that retains the successful GLB. Application verification and Eve compilation pass after the publication changes.
