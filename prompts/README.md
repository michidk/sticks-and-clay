# Sticks & Clay prompts

All authored agent instructions and input templates live here.

- `system.md`: shared Eve agent rules. `eve/agent/instructions.ts` loads this file at build time.
- `project-brief.md`: fills the initial project brief using TanStack AI.
- `designer.md`: uses TanStack AI to write the project's design reference.
- `model-brief.md`: uses TanStack AI to draft the editable Model brief from the approved design and requested count.
- `planner.md`: turns a submitted model brief into individual builder tasks.
- `builder.md`, `photographer.md`, `judge.md`: build, photograph the exported GLB, and visually review assets.
- `*-input.md`: task-specific input templates, with `{{placeholders}}` populated by the app.
- `modeling-pass.md`, `modeling-review.md`: required v4 modeling passes and review of their recorded changes.
- `resume.md`: continues a failed Eve turn in the same session.
- `pipeline.md`: the reusable asset-pack pipeline reference.

Each run stores the rendered inputs and role instructions in the database. Resumed runs retain their original instructions; edits apply to new runs. The shared Eve system prompt requires an Eve rebuild/restart after edits.

Model and effort settings are configured in `src/modules/ai/roles.ts` and shown at `/admin/agents`. Builder/judge instructions require developed geometry rather than unmodified primitive assemblies. Builders can use `generate_texture`, the TypeScript image-generation API integration, and must connect the generated images to UV-mapped materials. Triangle counts are informational metrics, with no budget configuration or enforcement.

`visual-target.md` drives the imagegen concept step. See [quality pipeline](../docs/quality-pipeline.md) for geometry gates, target thumbnails, image accounting and legacy recovery semantics.
