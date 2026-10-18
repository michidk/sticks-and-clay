# Sticks & Clay prompts

All authored agent instructions and input templates live here.

A prompt's name is its path under `prompts/` without `.md` (for example `design/designer`), which is what `src/modules/ai/roles.ts` and `prompt()` use. `<name>-input.md` beside an instruction file is its input template, with `{{placeholders}}` filled in by the app. Every file under these folders must be used by a role or a `prompt()` call; `src/modules/ai/prompts.test.ts` fails on an unused or missing one.

| Folder | Contents |
| --- | --- |
| `eve/` | `system.md`: shared Eve agent rules, loaded by `eve/agent/instructions.ts` at build time. `resume.md`: continues a failed Eve turn in the same session. |
| `project/` | `project-name`, `project-brief` (initial name and brief from the user's notes) and `idea-title` (names a saved idea from its brief when the title is left blank). |
| `design/` | The design reference: `designer` (3D), `graphic-designer`, `svg-designer`, `pixel-designer`, plus `design-update-input`, `design-from-model-input` and `design-mockup` (concept images from the approved design; with an open request it also gets a few unstarted saved ideas to pick from). |
| `planning/` | `model-brief` and `graphic-brief` draft the editable brief; `planner` and `graphic-planner` turn a submitted brief into individual tasks. SVG and pixel-art planning use the graphic planner. |
| `models/` | 3D generation: `builder`, `photographer`, `judge`, `visual-target` (the imagegen concept step), and the required v4 passes `modeling-pass` and `modeling-review`. |
| `graphics/` | `graphic` (the final prompt sent to the Image API) and `graphic-judge` with its input; the SVG and pixel judges share this input template. |
| `pixel/` | `pixel` (a plan with a numeric proportion plan, then a palette with one key per tone and rows of cells; frames or layers when asked; patches on revisions), `pixel-input` and `pixel-judge` (reads the review sheet and the named measurement warnings in a fixed critique order); their craft rules come from the surveyed pixel-art skills listed in `references/SOURCES.md`. |
| `svg/` | `svg` (a short plan, then the markup through the text model), `svg-input` and `svg-judge`. |
| `materials/` | `material-planner`, `material-builder` and `material-judge`. |
| `cad/` | Approved CAD design and planning, a frozen per-asset numeric specification, CadQuery source construction with bounded runtime repair, and independent visual review. `references/cad-construction.md` gives pinned construction and diagnostic guidance. |
| `references/` | Focused construction references added to role instructions, plus `SOURCES.md` and `WORKSHOP-INSPIRATION.md`, which are documentation and excluded from agent input. |
| `evaluations/`, `licenses/` | The control prompt for `scripts/evaluate-material-prompts.ts` and upstream MIT notices. Neither is model input. |

The judges for SVG, pixel art and raster graphics inspect renders and measurements and return the same verdict contract as the 3D judge, which drives revision rounds.

Each run stores the rendered inputs and role instructions in the database. Resumed runs retain their original instructions; edits apply to new runs. New builders edit persistent `asset.py` through native `asset_workspace` tools and run fixed `render.py` for quick/final exports. The photographer and historical sessions retain MCP tools. The shared Eve system prompt requires an Eve rebuild/restart after edits.

Model and effort settings are configured in `src/modules/ai/roles.ts` and shown at `/admin/agents`. Builder/judge instructions require developed geometry rather than unmodified primitive assemblies. Builders can use `generate_texture`, the TypeScript image-generation API integration, and must connect the generated images to UV-mapped materials. Triangle counts are informational metrics, with no budget configuration or enforcement.

`models/visual-target.md` drives the imagegen concept step for 3D models. Graphic projects send `graphics/graphic.md` directly through the same logged one-shot Image API adapter and retain the resulting PNG in collection and activity history. See [quality pipeline](../docs/quality-pipeline.md) for geometry gates, target thumbnails, image accounting and legacy recovery semantics.

## Focused construction references

Pixel craft guidance now includes cell-coordinate proportion planning, grips, internal form separation and shared baselines. Palette-specific black/white and hue choices override generic shading preferences. The independent judge receives native/background/silhouette/value evidence and treats new density measurements as advisory. Model toolkit guidance documents custom meshes, world-space placement and independent assembly copies, plus conservative spatial checks and explicit contact intent. Material guidance uses shared horizon AO and explains physical feature coupling, final-resolution evidence and sparse-map seam measurements. Existing saved role instructions remain authoritative on resume.

The builder's `references` list in `src/modules/ai/roles.ts` adds `references/modeling-method.md`, `hard-surface.md`, `organic-and-trees.md`, and `uv-and-materials.md` to its role instructions. Each is short and conditional on the asset and current pass. The judge receives `references/review-method.md`. The Eve adapter snapshots the entire assembled bundle on new runs and reuses stored instructions on resume. Agents do not need filesystem access to discover these documents. Main role prompts and the existing pipeline remain authoritative.

See [sources and adaptation notes](references/SOURCES.md) and `licenses/` for pinned upstream references and MIT notices. These are excluded from model input.

New builder runs select construction references by request and modeling stage, including `references/assetkit.md` and, for applicable requests, `references/game-interfaces.md`. The toolkit guidance develops actual profiles, lofts and supported organic forms; requires visual evidence and concrete corrections; preserves named pivots and interfaces; and explains draft/final publication. Preview effort bounds suggested self-review corrections independently of judge rounds; it does not change the four required passes. Saved instruction bundles remain authoritative on resume.

Accepted mockups with their notes, variation and effort are frozen into batch input, subordinate to the approved design. Scripts and visual examples are reference data, never instruction overrides. Texture generation can use explicitly authorized example images through the existing audited Image API. [Workshop design notes](references/WORKSHOP-INSPIRATION.md) describe the construction and workflow principles behind these prompts and helpers; that document is excluded from agent input. See [asset workshop](../docs/asset-workshop.md) for artifacts, invariants and verification.
