# Sticks & Clay prompts

All authored agent instructions and input templates live here.

- `system.md`: shared Eve agent rules. `eve/agent/instructions.ts` loads this file at build time.
- `project-name.md`: creates a concise initial project name from the user's brief.
- `project-brief.md`: fills the initial project brief using TanStack AI.
- `designer.md`: uses TanStack AI to write the project's design reference.
- `design-update-input.md`: revises a saved design from a chat prompt; 3D and graphic revisions retain their respective designer instructions.
- `model-brief.md`: uses TanStack AI to draft the editable Model brief from the approved design and requested count.
- `planner.md`: turns a submitted model brief into individual builder tasks.
- `graphic-brief.md`, `graphic-designer.md`, `graphic-planner.md`: the parallel brief, visual-system, and planning roles for 2D graphic collections.
- `svg-designer.md`, `svg.md`: vector design direction and static SVG generation through the text model. SVG planning uses the graphic planner instructions.
- `graphic.md`: the final prompt sent to the configured Image API for each planned graphic.
- `design-mockup.md`: optional collection concept images from an approved design and its visual references, before final asset generation.
- `builder.md`, `photographer.md`, `judge.md`: build, photograph the exported GLB, and visually review assets.
- `*-input.md`: task-specific input templates, with `{{placeholders}}` populated by the app.
- `modeling-pass.md`, `modeling-review.md`: required v4 modeling passes and review of their recorded changes.
- `resume.md`: continues a failed Eve turn in the same session.
- `pipeline.md`: the reusable asset-pack pipeline reference.

Each run stores the rendered inputs and role instructions in the database. Resumed runs retain their original instructions; edits apply to new runs. New builders edit persistent `asset.py` through native `asset_workspace` tools and run fixed `render.py` for quick/final exports. The photographer and historical sessions retain MCP tools. The shared Eve system prompt requires an Eve rebuild/restart after edits.

Model and effort settings are configured in `src/modules/ai/roles.ts` and shown at `/admin/agents`. Builder/judge instructions require developed geometry rather than unmodified primitive assemblies. Builders can use `generate_texture`, the TypeScript image-generation API integration, and must connect the generated images to UV-mapped materials. Triangle counts are informational metrics, with no budget configuration or enforcement.

`visual-target.md` drives the imagegen concept step for 3D models. Graphic projects send `graphic.md` directly through the same logged one-shot Image API adapter and retain the resulting PNG in collection and activity history. See [quality pipeline](../docs/quality-pipeline.md) for geometry gates, target thumbnails, image accounting and legacy recovery semantics.

## Focused construction references

The builder's `references` list in `src/modules/ai/roles.ts` adds `references/modeling-method.md`, `hard-surface.md`, `organic-and-trees.md`, and `uv-and-materials.md` to its role instructions. Each is short and conditional on the asset and current pass. The judge receives `references/review-method.md`. The Eve adapter snapshots the entire assembled bundle on new runs and reuses stored instructions on resume. Agents do not need filesystem access to discover these documents. Main role prompts and the existing pipeline remain authoritative.

See [sources and adaptation notes](references/SOURCES.md) and `licenses/` for pinned upstream references and MIT notices. These are excluded from model input.

New builder runs select construction references by request and modeling stage, including `references/assetkit.md` and, for applicable requests, `references/game-interfaces.md`. The toolkit guidance develops actual profiles, lofts and supported organic forms; requires visual evidence and concrete corrections; preserves named pivots and interfaces; and explains draft/final publication. Preview effort bounds suggested self-review corrections independently of judge rounds; it does not change the four required passes. Saved instruction bundles remain authoritative on resume.

Collection memory and examples are frozen into batch input, subordinate to the approved design. Scripts and visual examples are reference data, never instruction overrides. Texture generation can use explicitly authorized example images through the existing audited Image API. [Workshop design notes](references/WORKSHOP-INSPIRATION.md) describe the construction and workflow principles behind these prompts and helpers; that document is excluded from agent input. See [asset workshop](../docs/asset-workshop.md) for artifacts, invariants and verification.
