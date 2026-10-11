# Asset workshop

The workshop adds reusable construction and visual correction to the existing v4 generation graph. It keeps approved design snapshots, four required modeling passes, immutable versions, separate artistic judging, and existing run/session/cost recovery. The prompts and helpers support staged construction, reusable modeling vocabulary and collection consistency. See [workshop design notes](../prompts/references/WORKSHOP-INSPIRATION.md).

## Generation and prompts

New builders receive relevant construction guides selected by the request and stage. `assetkit` supplies developed geometry (extrusions, lathes, lofts, tubes, seeded rocks and supported trees), materials/UV helpers, named roots and meaningful pivots. Guides emphasize primary shape relationships before detail, actual openings and thickness, thumbnail readability, and observed defects tied to specific parts and views.

New builders author a persistent `asset.py` using the native `asset_workspace` tool: bounded reads, complete writes and exact block edits with optional SHA-256 checks against stale source. Each changed script is retained under `script-revisions/<hash>.py`. The workspace starts with the preceding archived program when available, its fixed `params.json` (including seed), pinned geometry helpers, textures and authorized dependencies. Builders can change the asset program; parameters and runner support remain read-only through the tool.

`asset_workspace(operation="run", mode="quick")` runs the saved program with the fixed `render.py` runner in a clean Blender process and produces three small draft views. `view_render` exposes those through the existing vision transport. The prompt requests a bounded correction loop: quick allows up to one, standard three, thorough five. This is instruction-level guidance, independent of judge rounds, with no imposed polygon budget. Every completed modeling pass needs a successful execution with `mode="final"`; subsequent script edits invalidate that result.

Native authoring calls the capability-scoped loopback `/workspace` endpoint directly, outside the MCP protocol. The same service retains MCP for the independent photographer and historical builder sessions that still call `execute_blender_code`. New builder prompts need no MCP discovery or arbitrary shell execution. Standalone bundles need neither Eve nor MCP.

Builds use both per-capability locking and a shared concurrency limit (`BLENDER_CONCURRENCY`, default two). They execute in fresh candidate directories with pinned support code. A successful candidate is published to its workspace; failed scripts do not replace prior successful files. `build-state.json` prevents a failed final execution from handing stale files to the next pipeline step. Drafts are stored separately under `preview/` and cannot become a final delivery. Last-good draft images carry a failure note when appropriate.

## Collection memory and examples

The Collection style panel saves explicit user-owned memory, style, variation and up to three completed examples. Optimistic version checks reject a stale save without silently overwriting newer guidance. Agents can suggest lessons in their summary; they cannot silently edit memory.

Each new batch freezes the guidance and example artifact keys. The approved design and current asset task have priority. Finished 3D examples provide renders, source scripts/blends and authorized generated texture references; graphics provide saved images. A normal fork retains its parent batch snapshot. **Match current collection style** explicitly freezes current guidance into a new linked model while retaining the selected version's design contract.

Measured style comparisons are advisory: GLB material factors, base-color factors and image counts can expose drift. They do not measure texture pixels, bevel widths, perceived palette, silhouettes or visual similarity. Artistic judges and user review remain necessary.

## Reproducible versions

New source bundles contain `asset.py`, `render.py`, `params.json`, `helpers.py`, `assetkit/`, `rebuild.py`, script revisions, `build-config.json`, `build-request.json`, source `.blend`, original `source.glb`, cleaned delivery `asset.glb`, textures, copied authorized inputs, metrics, optional sprites/LODs and `build-manifest.json`. The manifest records file hashes, saved run input, instructions and Blender/helper versions. The source and cleaned delivery are distinct because platform cleanup can alter delivery geometry.

Extract the ZIP to a new directory and run:

```sh
python render.py --mode final
# Cheap visual iteration after editing asset.py:
python render.py --mode quick
# Explicit Blender installation (also accepts BLENDER_BIN):
python render.py --mode final --blender "/path/to/blender"
```

The ordinary Python launcher starts Blender headlessly with a clean scene and a timeout. It remaps original workspace and authorized input paths into the extracted bundle. Seed parameters and original texture filenames are preserved; the runner seeds Python and NumPy randomness before executing the program. Rebuilding makes no API requests. Python 3 and Blender with its supported Python modules are required; scripts relying on additional unbundled dependencies are not made portable automatically. Match the recorded Blender version for reproducibility; image bytes are not guaranteed identical across render devices or versions. The runner regenerates source exports; Studio's later delivery cleanup is recorded separately. Older bundles without `render.py` use `blender -b --python rebuild.py`. Existing pre-upgrade archives remain immutable and may have no bundle.

## Optional game outputs

Small authored starting scripts live in [`blender/examples/`](../blender/examples): a lofted scout hull, a supported seeded tree and a passage module. Save their complete code as `asset.py` through `asset_workspace`, or adapt it inside a source bundle. They demonstrate the helper vocabulary and require development against the actual brief.

`kit.root`, `pivot` and `socket` preserve part hierarchy and local attachment intent. Blender uses Z-up metres and -Y front; exported sockets use local +Z forward after glTF conversion. `grid_piece`, `collider`, `slot`, `allow_overlap` and `open_surface` declare explicit intent. `clip` creates named NLA tracks from authored animation; `event` records timing against real nodes. Readiness reports source boundary/non-manifold/degenerate faces, UVs, finite transforms, grid dimensions, hierarchy, sockets, slots and events. It does not prove exported collision fit, self-intersection freedom, engine attachment behavior or animation quality.

`finish_asset(..., sprites={"directions":8,"frames":[1,8,16],"size":128})` renders the actual model with transparency and a JSON frame layout. `finish_asset(..., lod_ratios=[0.5,0.25])` exports up to three separate static LOD GLBs without changing source geometry. LOD generation rejects animated, rigged and morph assets. These outputs are requested explicitly; there is no automatic polygon budget or PBR generator.

## Version actions and imports

The Checks tab separates technical readiness from artistic feedback. Users can select findings to seed a focused repair fork or request current collection style. These actions create linked models and retain the selected source and original history.

Render again and sprite export use queued local Blender presentation jobs against the exact archived GLB. Outputs live under a separate presentation key and never overwrite that version. These actions create no AI call or token charge. Graphics can fork a variant using the selected saved image as an edit reference; no Blender or 3D judge is involved.

Approved 3D projects can import a GLB v2 or Blender source up to 200 MB. Imports preserve the original file and start an ordinary reviewed model job with an immutable design/style snapshot. Builders receive explicit instructions to open `.blend` or import `.glb`, inspect it and preserve applicable interfaces while revising it. Like generated scripts, imported Blender content belongs in this trusted local workshop.

## Upgrade and verification

Apply migration `0011` (`bun run db:migrate`), rebuild/restart Eve for tool changes, and restart Blender MCP for new build behavior. Resumed runs retain saved prompt instructions; support files are pinned on a workspace's first toolkit execution. A standard Eve build also prewarms its Docker sandbox. When registry access is unavailable, `eve build --skip-sandbox-prewarm` verifies compilation only.

```sh
bun run typecheck
bun test src
bun run build
bun run eve:typecheck
TEST_DATABASE=1 bun test src/lib/workshop.integration.test.ts src/lib/versions.integration.test.ts
BLENDER_BIN=blender .venv/bin/python -m unittest blender.test_build_workflow blender.test_workspace blender.test_cancellation
blender -b --factory-startup --python-exit-code 1 --python blender/test_assetkit_shapes.py
```

Integration tests need an isolated PostgreSQL database. The Blender workflow test executes native draft/final builds, animated socket/sprite output, last-good preservation and a relocated offline ZIP rebuild after the original input changes. Workspace tests cover stale edits, saved revisions, fixed seed inheritance, role scoping and the actual HTTP route. Shape tests inspect manifold geometry, deterministic rocks and static LOD socket preservation. These tests validate workflow and artifact mechanics; they do not establish the artistic quality of a paid agent generation.
