# Asset workshop

The workshop adds reusable construction and visual correction to the existing v4 generation graph. It keeps approved design snapshots, four required modeling passes, immutable versions, separate artistic judging, and existing run/session/cost recovery. The prompts and helpers support staged construction, reusable modeling vocabulary and collection consistency. See [workshop design notes](../prompts/references/WORKSHOP-INSPIRATION.md).

## Generation and prompts

New builders receive relevant construction guides selected by the request and stage. `assetkit` supplies developed geometry (extrusions, lathes, lofts, tubes, seeded rocks and supported trees), materials/UV helpers, named roots and meaningful pivots. Guides emphasize primary shape relationships before detail, actual openings and thickness, thumbnail readability, and observed defects tied to specific parts and views.

New builders author a persistent `asset.py` using the native `asset_workspace` tool: bounded reads, complete writes and exact block edits with optional SHA-256 checks against stale source. Each changed script is retained under `script-revisions/<hash>.py`. The workspace starts with the preceding archived program when available, its fixed `params.json` (including seed), pinned geometry helpers, textures and authorized dependencies. Builders can change the asset program; parameters and runner support remain read-only through the tool.

`asset_workspace(operation="run", mode="quick")` runs the saved program with the fixed `render.py` runner in a clean Blender process and produces three small draft views. `view_render` exposes those through the existing vision transport. The prompt requests a bounded correction loop: quick allows up to one, standard three, thorough five. This is instruction-level guidance, independent of judge rounds, with no imposed polygon budget. Every completed modeling pass needs a successful execution with `mode="final"`; subsequent script edits invalidate that result.

Native authoring calls the capability-scoped loopback `/workspace` endpoint directly, outside the MCP protocol. The same service retains MCP for the independent photographer and historical builder sessions that still call `execute_blender_code`. New builder prompts need no MCP discovery or arbitrary shell execution. Standalone bundles need neither Eve nor MCP.

Builds use both per-capability locking and a shared concurrency limit (`BLENDER_CONCURRENCY`, default two). They execute in fresh candidate directories with pinned support code. A successful candidate is published to its workspace; failed scripts do not replace prior successful files. `build-state.json` prevents a failed final execution from handing stale files to the next pipeline step. Drafts are stored separately under `preview/` and cannot become a final delivery. Last-good draft images carry a failure note when appropriate.

## Mockup direction

There is no separate style memory or style-example picker. The Mockups tab is the visual direction: users generate concept images, revise any mockup in a chat, upload their own, and mark the ones they like **Use as reference** (with an optional note). A marked mockup is simply one of the project's reference images (up to six); it appears with the others on the Design tab, where each saved reference can carry a note ("I like the thin outlines, keep icons simpler") and be removed. Mockups are stored in `mockups` rows (generated, revised or uploaded) and never alter the approved design themselves.

Each new batch freezes the notes on the project's reference images (numbered by position), plus variation and 3D self-review effort, into its workshop snapshot. The reference images themselves go to planning, visual targets and builds as before, and the notes are added to the prompt as lower-priority context. The approved design and current asset task have priority. New mockups are generated from the same inputs: the approved design, the project references and their notes (a mockup being revised is sent once, first). When the request names no subject, up to four saved ideas that were not started yet are listed so each concept can show a different one. Later edits to references or notes never change a batch already started. Batches saved before this change keep their accepted-mockup, memory, style and example snapshots and still show them to their prompts. A normal fork retains its parent batch snapshot. **Match references** explicitly freezes the current reference notes into a new linked model while retaining the selected version's design contract.

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

`finish_asset(..., sprites={"directions":8,"frames":[1,8,16],"size":128})` renders the actual model with transparency and a JSON frame layout. `finish_asset(..., lod_ratios=[0.5,0.25])` exports up to three separate static LOD GLBs without changing source geometry. LOD generation rejects animated, rigged and morph assets. These outputs are requested explicitly; there is no automatic polygon budget.

## Version actions and imports

The Checks tab separates technical readiness from artistic feedback. Users can select findings to seed a focused repair fork or match the project's references. These actions create linked models and retain the selected source and original history.

Render again and sprite export use queued local Blender presentation jobs against the exact archived GLB. Outputs live under a separate presentation key and never overwrite that version. These actions create no AI call or token charge. Graphics can fork a variant using the selected saved image as an edit reference; no Blender or 3D judge is involved.

Approved 3D projects can import a GLB v2 or Blender source up to 200 MB. Imports preserve the original file and start an ordinary reviewed model job with an immutable design/style snapshot. Builders receive explicit instructions to open `.blend` or import `.glb`, inspect it and preserve applicable interfaces while revising it. Like generated scripts, imported Blender content belongs in this trusted local workshop.

## PBR material mode

Approved 3D collections include a **PBR materials** tab. Six recipes support physical tile/feature/height dimensions, fixed seeds, moisture/dirt and particle burial/variation. Generate maps stays local. Generate from brief uses `material-builder` to author a pinned Python script, then executes quick and final builds and invokes `material-judge` on current final-resolution evidence. Runtime repair is capped at two attempts per iteration; independent judging is capped at five rounds. Zero rounds still constructs and renders but remains unreviewed. Major findings prevent approval even if a judge returns `passed: true`. The mode uses Python/NumPy/Pillow, not an image-generation API.

Continue a saved material to create a linked immutable revision. Same-kind style examples are frozen into the request; a previous result is clearly distinguished from current output. The shared pipeline and serialized checkpoints replay completed agent results without another paid request. The material viewer provides physical-scale plane/sphere previews, channel inspection, lighting, comparisons and explicit UV/material-slot assignment. Assignments create derived GLBs with source/material dependencies and never overwrite originals.

Source ZIPs include pinned helpers and calibration targets. Delivery ZIPs contain runtime maps/frames and import instructions. The optional content cache verifies every artifact hash and retains at most 32 entries; saved versions and offline bundles do not depend on it. Reference-response calibration is disabled by default and only supports the measured wood/brick examples. `scripts/measure-materials.py` reproduces those CC0 measurements (Powered by Poly Haven); `scripts/evaluate-materials.py` records local recipe comparisons. Statistics do not establish photorealism or replace visual review.

The original toolkit constructs periodic Fourier fields, wrapped particle footprints or periodic material layouts. Gravel has rounded particles with individual color regions; sand has periodic ripples; stone has level-set cracks; wood has grain bands; brick has alternating rows/mortar; painted metal has dielectric paint and exposed metallic regions. Feature scale and coverage have recipe-specific meanings. These are procedural starter materials, not photoscans, scan-calibrated physical measurements or a full simulation catalog. Unsupported custom structures need an edited offline script or a future toolkit extension.

Height, normals and occlusion share one height field. Base color is generated in linear space and exported as sRGB without directional lighting or AO. The other maps are linear: roughness, metallic, tangent normal (OpenGL +Y), 16-bit height and occlusion. Height is centered at 0.5; `material.json` records its physical millimetre window. `orm.png` packs occlusion, roughness and metallic into R/G/B. Review shows a lit 2x2 repetition, 1:1 albedo crop, sphere and the channels. Reports expose channel ranges, mean roughness, finite-value checks and wrap-edge ratios relative to adjacent pixel differences; warnings ask for inspection rather than claiming artistic approval or seam perfection.

Each completed material retains immutable maps under its own job key, saved history, the recipe, approved context, pinned `materialkit.py`, `asset.py`, `render.py`, exact dependency versions and SHA-256 manifests. Download `source.zip`, extract, run `python -m pip install -r requirements.txt`, then `python render.py --mode final`. `--mode quick` writes a separate preview without replacing final outputs. Builds need Python 3.11+, NumPy and Pillow; the app uses its `.venv` by default or `STUDIO_PYTHON`. Existing queues expose cancellation and resume. A new seed or edited recipe creates another saved export. Maps are downloadable. Material assignment requires an explicit slot selection and suitable UV coordinates; it creates a derived GLB.

## Pixel sprites from 3D

Version tools include **Export 3D sprites**. Choose pixel mode, 1/4/8 directions, 32/64/128/256-pixel cells, up to 16 animation samples, playback FPS, a shared 2-32-color palette or explicit hex colors, and an optional outline (a hex color, or `auto`). A clip name can select an imported NLA track; blank uses the imported active animation. Invalid clip names fail visibly. Static assets produce one distinct pose even if more frames are requested.

The separate local Blender renderer imports the exact archived GLB and fits bounds across sampled poses. Orthographic camera directions start at the model's -Y front. Pixel mode rotates lights with the camera, renders at four times the cell size, filters premultiplied RGBA, thresholds alpha, quantizes one palette across the entire sheet in OKLab (so equally bright hues stay apart) and draws a cell-contained outline. `auto` outlines use the darkest sheet color darkened, or a custom palette's darkest color so the outline stays on the palette. Smooth mode retains rendered color and transparency. Rows are animation frames, columns directions; `sprites.json` records cells, frame numbers, direction angles, FPS, palette settings and rendering conventions. The color budget includes outlines: an added outline color takes one of the budgeted slots. Custom palettes cannot exceed the budget; an outline is mapped into the supplied palette. Loop sampling excludes the repeated endpoint. Clip selection, elevation, padding, zoom and stable ground/center pivots are recorded. The camera orbits the vertical axis through the anchor, so every cell shares one pivot; `sprites.json` (version 3) records it with its integer baseline row, which is the sheet's baseline alignment. In pixel mode `sprite-checks.json` adds, per cell, the value range (warned below 0.35), the drawn pixel size and share of one-pixel runs (2x2 blocks are flagged) and the lowest opaque row, plus each direction's baseline against the ground pivot. `sprites.unity.json` (point filtering in pixel mode, no compression, pixels per unit, the shared pivot, bottom-left rects and one clip per direction) and `sprites.godot.json` (one SpriteFrames animation per direction with regions, speed, loop and the feet offset) are written beside the sheet; apply them with an importer script. Playback provides integer zoom, direction/frame controls, backgrounds, silhouette/grayscale inspection and individual frames. Paged evidence sheets remain bounded for inspection.

The saved source GLB remains byte-for-byte unchanged. Outputs, receipt and source ZIP live under a separate job key, and history survives reloads. Download the bundle and run `python render.py --blender /path/to/blender`; it includes the GLB, parameters, runner, pixel helpers and file hashes, with no agent or service dependency. Match the recorded Blender version; image bytes can vary by device/version. Native authored builds can request the same processing through `finish_asset(..., sprites={...})`; agents can inspect final `view_render(view="sprites")` or current quick `view_render(view="preview_sprites")`. The prompt asks for native-size silhouette and animation review, joint pivots for limbs, and the loop convention (key the first pose again at the end; the renderer drops that terminal sample). This feature renders 3D assets; drawn 2D pixel art is the separate `pixel` asset type below.

## Pixel art drawings

Pixel-art projects (`assetType: "pixel"`) are drawn cell by cell by a text model and rendered exactly; see [AI architecture](ai-architecture.md#reviewed-single-artifact-assets-graphics-svg-pixel-art) for the role, review and retry. Each version stores, beside `pixel.png` (one image pixel per cell, the asset), `preview.png` (enlarged on white, for vision references), `review.png` (the review sheet the judge and the reviser see), `grid.json` (the cells, `version: 2`) and the engine files listed under `artifacts.exports`:

- `sheet.png` and `sheet.json`: the frames in one row, moved as a whole so the feet (lowest drawn row, middle of the bottom band) stand one cell above the cell's bottom edge on its centre column; cells are rounded to even sizes. `sheet.json` records the cell size, FPS, loop, pivot and baseline in the sprite-player layout, so the version page plays animations from it.
- `sheet.unity.json`: TextureImporter and sprite settings (Sprite, Single or Multiple, point filtering, uncompressed, no mipmaps, 16 or 32 pixels per unit), the custom pivot normalised from each cell's bottom-left, bottom-left rects, and the animation clip.
- `sheet.godot.json`: a SpriteFrames description with nearest filtering, one region per frame, speed, loop, and the offset that puts the feet on a centred AnimatedSprite2D's origin.
- `anim.gif` for animations; `layer-NN-name.png` per paperdoll layer and `layers.json` (order, file names and anchors).

Animation and paperdoll layers are requested in the brief or approved design. An animation shares one grid and palette across up to 8 frames with FPS and loop; the analysis lints every frame and reports change between frames, the loop seam and silhouette overlap. A paperdoll has a base layer and up to 9 named full-size layers bottom to top, composited for the cover image, with named anchor cells. Versions saved before these files existed keep their `pixel.png`, `preview.png` and `grid.json` and render as before; ZIP exports include the engine files under `exports/`.

## Upgrade and verification

Install the updated `blender/requirements.txt` (including material dependencies). Apply migrations through `0013` (`bun run db:migrate`), rebuild/restart Eve for tool changes, and restart Blender MCP for new build behavior. Resumed runs retain saved prompt instructions; support files are pinned on a workspace's first toolkit execution. A standard Eve build also prewarms its Docker sandbox. When registry access is unavailable, `eve build --skip-sandbox-prewarm` verifies compilation only.

```sh
bun run typecheck
bun test src
bun run build
bun run eve:typecheck
TEST_DATABASE=1 bun test src/lib/workshop.integration.test.ts src/lib/versions.integration.test.ts src/lib/materials.integration.test.ts
BLENDER_BIN=blender .venv/bin/python -m unittest blender.test_build_workflow blender.test_workspace blender.test_cancellation
python -m unittest blender.test_materials
blender -b --factory-startup --python-exit-code 1 --python blender/test_assetkit_shapes.py
blender -b --factory-startup --python-exit-code 1 --python blender/test_sprite_render.py
```

Integration tests need an isolated PostgreSQL database. The Blender workflow test executes native draft/final builds, animated socket/sprite output, last-good preservation and a relocated offline ZIP rebuild after the original input changes. Workspace tests cover stale edits, saved revisions, fixed seed inheritance, role scoping and the actual HTTP route. Shape tests inspect manifold geometry, deterministic rocks and static LOD socket preservation. These tests validate workflow and artifact mechanics; they do not establish the artistic quality of a paid agent generation.

Material tests check every recipe, seed determinism, physical normal derivatives, range validation, 16-bit PNG encoding, packed channels, hashes and offline execution. Database tests verify frozen context, real maps, source ZIPs, saved history and checkpoint resume. Sprite tests use an actual animated GLB, check sampled frames, source preservation, shared palettes, binary alpha, cell-local and automatic on-palette outlines, OKLab quantisation, per-cell pixel checks and the Unity and Godot descriptions. Pixel-art unit tests (`src/lib/pixel.test.ts`, `src/lib/pixel-export.test.ts`) cover the craft metrics, palette enforcement and snapping, patches, frames and layers, version 1 grids, the review sheet and the sheet exports.

### Referencing a model part

Select a mesh in the 3D view or scene inspector before writing a change request. Its name and hierarchy appear above the composer; remove the reference with its close button, click empty space in the viewer, or press Escape while the viewer is focused. Iterate and Fork variant send that reference with the selected saved version. Changing versions clears the selection. The submitted message keeps a link to its source version, and the builder receives the object name, parent path and archived GLB identifier.

New modeling prompts require stable descriptive names and meaningful parent hierarchies so parts remain identifiable across passes. Existing assets retain their original naming; ambiguous references must be reported by the builder rather than silently matched to another part.
