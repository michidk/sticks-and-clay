# Asset workshop

The workshop adds reusable construction and visual correction to the existing v4 generation graph. It keeps approved design snapshots, four required modeling passes, immutable versions, separate artistic judging, and existing run/session/cost recovery. The prompts and helpers support staged construction, reusable modeling vocabulary and collection consistency. See [workshop design notes](../prompts/references/WORKSHOP-INSPIRATION.md).

## Idea starting points

An idea can carry one primary starting point separately from appearance references. Upload a file or select a compatible completed version in the project; CAD saved versions seed from their STEP geometry. Source receipts contain the original filename, format, SHA-256, units, derived previews and import mode. Replacement/removal uses the current hash to reject stale edits. Source changes are restricted to Ideas, and every new generation freezes its own receipt in the batch snapshot. Old sources and previous versions remain intact. Generated variants continue from their selected version before considering the original idea source.

- Models: GLB, Blender, STL and OBJ. Fixed Blender import produces a GLB baseline; STL/OBJ units are selectable (mm, cm, m, inches). GLB/Blender use their native scene conventions.
- CAD: CadQuery Python, STEP/STP, STL, GLB, OBJ and Blender. Python is retained without execution at upload; STEP provides native solids. Mesh inputs are rendered and measured as reconstruction evidence for an editable CadQuery result, with approximation disclosed.
- SVG and graphics: SVG, PNG, JPEG, WebP, GIF, BMP and TIFF. Native SVG uses the existing static SVG allowlist; unsupported active/external content is rejected. Raster inputs for SVG are redrawn into editable paths. Graphics use a normalized image as the editing source. Still-image workflows use the first GIF/TIFF image.
- Pixel: saved grid JSON, PNG or GIF. Imported raster art is fitted to at most 128×128 cells using nearest-neighbor sampling and a shared palette of at most 32 entries, with binary transparency; up to eight GIF frames are retained. The original file is preserved alongside the converted grid.

Uploads are limited to 200 MiB, text to 8 MiB, and CadQuery Python to 200,000 bytes. Images have a 40-million-pixel decode limit. File bytes are decoded/validated before publication, ownership and receipts are checked before generation, and reference images retain their separate existing limits.

## CAD generation

CAD projects use a separate CadQuery 2.8 runtime and the shared bounded build/review graph. A per-asset specification snapshots explicit dimensions/counts and declared assumptions before source generation. Only explicit requirements become hard numeric review gates. Builders return complete Python; the host executes it in a fresh supervised process, performs up to two runtime repairs, and owns all exports. Dependency failures and cancellation are not repaired by silently removing features. Zero judge rounds still builds, validates and photographs one unreviewed candidate.

The canonical model uses Z-up millimetres. The runner checks valid positive-volume solids, measures bounds, volume, solid count and inward cylindrical surfaces, exports STEP, reloads it to check validity/count/volume, and validates the tessellated mesh's closure. STL and meter-space GLB are derived outputs. A fixed independent Blender process renders front, rear, left, right, top, bottom and isometric images from the exported GLB at a common orthographic scale. The judge sees those images, the frozen contract and measured checks. Failed or unknown required checks prevent approval even if the visual judge returns a pass. Unsupported properties such as thread fit, through-hole status, minimum wall thickness, structural strength and manufacturing suitability remain explicitly unverified.

Every iteration stores source, STEP/STL/GLB, seven photographs, metrics, checks and a hashed manifest. The source ZIP includes the pinned runner/helpers, specification, dependencies and requirements; install the included requirements and run `python runner.py --blender /path/to/blender`. Optional `--mode quick` writes a separate preview. Completed candidate checkpoints verify artifact hashes on resume. Failed builds preserve the preceding good output. STEP inputs and preceding iterations receive dimensional/volume comparisons; visual evidence retains its coordinate frame. The version page provides the 3D viewer, measurements, review views and downloads. Owner acceptance stays explicit.

CAD source executes with the trusted workshop service user's permissions, like generated Blender Python; process supervision is not an OS sandbox. Keep the existing single-owner deployment boundary.

## Generation and prompts

New builders receive relevant construction guides selected by the request and stage. `assetkit` supplies developed geometry (extrusions, lathes, lofts, tubes, seeded rocks and supported trees), materials/UV helpers, named roots and meaningful pivots. Guides emphasize primary shape relationships before detail, actual openings and thickness, thumbnail readability, and observed defects tied to specific parts and views.

New builders author a persistent `asset.py` using the native `asset_workspace` tool: bounded reads, complete writes and exact block edits with optional SHA-256 checks against stale source. Each changed script is retained under `script-revisions/<hash>.py`. The workspace starts with the preceding archived program when available, its fixed `params.json` (including seed), pinned geometry helpers, textures and authorized dependencies. Builders can change the asset program; parameters and runner support remain read-only through the tool.

`asset_workspace(operation="run", mode="quick")` runs the saved program with the fixed `render.py` runner in a clean Blender process and produces three small draft views. `view_render` exposes those through the existing vision transport. The prompt requests a bounded correction loop: quick allows up to one, standard three, thorough five. This is instruction-level guidance, independent of judge rounds, with no imposed polygon budget. Every completed modeling pass needs a successful execution with `mode="final"`; subsequent script edits invalidate that result.

Native authoring calls the capability-scoped loopback `/workspace` endpoint directly, outside the MCP protocol. The same service retains MCP for the independent photographer and historical builder sessions that still call `execute_blender_code`. New builder prompts need no MCP discovery or arbitrary shell execution. Standalone bundles need neither Eve nor MCP.

Builds use both per-capability locking and a shared concurrency limit (`BLENDER_CONCURRENCY`, default two). They execute in fresh candidate directories with pinned support code. A successful candidate is published to its workspace; failed scripts do not replace prior successful files. `build-state.json` prevents a failed final execution from handing stale files to the next pipeline step. Drafts are stored separately under `preview/` and cannot become a final delivery. Last-good draft images carry a failure note when appropriate.

## Construction checks

New toolkit snapshots include world-bounds placement (`sit_on_ground`, `place_on`), independent mirrored assemblies and circular arrays, weighted normals, and `check()` for readiness without an export. Copies include child hierarchy and independent mesh data. They do not retarget constraints or rig references; inspect those explicitly before claiming animation readiness. `allow_asymmetry` records intent; it does not run a symmetry proof.

Readiness v2 includes bounded spatial evidence from evaluated mesh triangles. `CLIPPING` reports intersecting or touching surfaces, including coplanar contacts; intentional joints can use `allow_overlap(a, b, reason)`. `contact` declares expected mesh support, with `GAP` only when world bounds prove separation. `ground_contact` checks an explicitly declared world ground plane and reports `FLOATING` or `GROUND_PENETRATION`. Bounds overlap does not prove support, and surface checks miss fully enclosed solids. Pair/triangle budget skips and current-pose-only coverage are reported. These checks are advisory evidence for the builder and independent judge, not an artistic pass or an export veto. Existing pinned source bundles retain their toolkit.

## Mockup direction

There is no separate style memory or style-example picker. The Mockups tab is the visual direction: users generate concept images, revise any mockup in a chat, upload their own, and mark the ones they like **Use as reference** (with an optional note). A marked mockup is simply one of the project's reference images (up to six); it appears with the others on the Design tab, where each saved reference can carry a note ("I like the thin outlines, keep icons simpler") and be removed. Mockups are stored in `mockups` rows (generated, revised or uploaded) and never alter the approved design themselves.

In the Design reference editor, **Add from finished assets** lets you copy a finished image or a rendered photo from this project into the draft reference images. Models offer their saved photos, SVGs offer raster previews, and CAD assets offer their rendered views. Save the document to retain the references; approval remains an explicit owner decision. The six-image limit also applies to these copies.

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

New material toolkits export `hdrp_mask.png` (metallic, AO, constant-one detail mask, smoothness), `urp_metallic_smoothness.png` (metallic in R, smoothness in A), and `normal_dx.png` (green inverted from the OpenGL normal). All packed channels are linear data. Metadata records channel meanings, manifests hash the files, and the material history publishes them when present while retaining older bundles. The 1:1 evidence crop is lit; separate channel evidence remains unlit. Seam warnings compare the wrap step to the busiest 1% of interior differences. Composed and base surfaces share horizon AO. Calibration retains source statistics but skips roughness adjustment for constant endpoint reference maps rather than treating them as useful measurements.

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

Pixel projects show a palette above the design reference images and mockup gallery.
Use **Add palette** or **Edit palette**, enter six-digit hex colors, then apply and
save the design. The `## Pixel palette` section stores 1–64 distinct opaque colors;
each sprite still uses at most 32 colors. A Markdown table with color names and hex
values works too. Invalid sections can be saved as drafts but cannot be approved.
Ask for a palette in the design chat to have AI propose one from the brief and
reference images. AI design drafts include this section and keep existing colors
unless asked to change them. Review and approve the draft before generating.

New pixel generations use only colors from that section, even when a request names
a classic preset. Without the section, named palettes continue to work. Mockup
image prompts receive the same exact colors, though image-provider output is not
quantized like the final pixel grid. The palette is part of the design revision
and each batch snapshot, so editing it does not recolor existing images or change
queued work. Swatches show the current design revision, not a palette extracted
from each historic image.

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

## Graphic and pixel-art resolution

The Design tab has an optional project width and height. Each asset can override
both in Generation settings; leaving both blank inherits the project setting.
Clearing the project setting lets generation choose. New batches freeze the
resolved size and attach it to planning, generation and review prompts. Existing
queued versions retain their snapshots.

Pixel art supports 4–128 pixels per dimension. An explicit resolution is fixed;
otherwise the source grid or first generated grid establishes the dimensions for
all review rounds and recovery. Graphics accept requested dimensions from 4–8192
pixels and send that exact size to the image API. Without an explicit resolution,
the source image dimensions or saved canvas setting are used. Provider and model
support can vary. The app never substitutes a nearby preset, resizes or crops to
hide a mismatch.

Dimension mismatches finish with issues rather than failing the job. The returned
artifact stays available, and Review shows the requested and actual dimensions,
even with zero judge rounds. An AI judge cannot approve a mismatched output.
An explicit provider rejection of the size also finishes with a dimension finding;
if no image was produced there is no new artifact. Recovery does not retry that
rejected request automatically. Only the owner should change or clear dimensions.
Unrelated project and asset edits preserve omitted resolution and canvas fields.

SVG generation always requests a square viewBox with a 1:1 aspect ratio. SVG
coordinates describe vector units, not a raster output resolution. A non-square
viewBox is a dimension review finding.
