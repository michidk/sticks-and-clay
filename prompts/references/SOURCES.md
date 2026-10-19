# Construction reference sources

Reviewed 2026-09-30. These focused instructions adapt ideas from the following MIT-licensed skill repositories. They are intentionally rewritten for Asset Studio's existing Blender tools, staged workflow, GLB exports and immutable history; no upstream scripts are installed or executed. Copyright and permission notices are retained in `../licenses/`.

| Source at reviewed revision | Adapted guidance | Local reference |
| --- | --- | --- |
| [Blender Game Skills](https://github.com/majidmanzarpour/blender-game-skills/blob/f0ef29385a03de139957e6f700b801cdc00b7e29/skills/blender-image-to-3d/SKILL.md) | Reference proportions, inferred dimensions, construction order, shape methods, checker UV inspection and aligned baking | modeling-method, hard-surface, uv-and-materials |
| [Blender Skills](https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52) — hard-surface, vegetation-artist, uv-workflow, texture-workflow | Selective bevels and construction seams, branch hierarchy, atlas/UV planning | hard-surface, organic-and-trees, uv-and-materials |
| [CC Blender atlas fitting](https://github.com/RobLe3/cc-blender-skill/blob/11016c9a5847897491dde935c346571bd7548e3d/plugin/skills/atlas-uv-fitting/SKILL.md) and quality-refinement-autoloop | Semantic part-to-atlas mapping; separate geometry/UV/look failures | uv-and-materials, review-method |
| [Dream Loop Pro](https://github.com/achimala/dream-loop/blob/9bddb901f7d071cfefdd21e264267c757177a9df/references/pro-mode/workflow.md) | Reconsider the method when the same defect survives revisions; recognize regressions | modeling-method, review-method |
| [Astra Blender Characters](https://github.com/icesixgod/awesome-astra-blender-characters/blob/2b54222f8d39db7ba7ae7444d6fec985be7ad5b1/skills/blender-character-workflow/references/production-workflow.md) | Distinguish camera/shape/shading problems, recheck other angles, subdivision is not shape repair | modeling-method, organic-and-trees, review-method |

Excluded upstream conventions: triangle quotas, mandatory LODs/rigs, new approval/validation gates, exact pixel matching, universal modifier recipes, automatic external asset/API acquisition, and unvalidated generated normal maps. The UV density expression here includes world-space length, correcting the dimensionally incomplete expression in the upstream UV skill. Render comparison infrastructure is not added; agents use the existing images and reports.

Upstream quality claims have not been benchmarked locally. These references provide methods, not evidence that a generated asset meets the design. Sources and licenses are documentation only and are not injected into agent context.

## Pixel art prompts

Reviewed 2026-10-17. The `pixel/` and `design/pixel-designer` prompts adapt ideas, rewritten in our own words for a text-drawn grid; nothing is copied or executed from these projects.

| Source | Adapted guidance |
| --- | --- |
| [Sprite skill (melodic-software)](https://www.skillsdirectory.com/skills/melodic-software-sprite) | Palette-locked grid spec with a single key per color and `.` as transparent; named palette presets are never retyped by hand; a render-review loop that checks silhouette at 1x, part separation, light consistency, outline, stray pixels and palette discipline; keep the spec so a revision edits source rather than pixels |
| [Pixel Art Generator skill (mcpmarket)](https://mcpmarket.com/tools/skills/pixel-art-generator) | Grid size by subject complexity, a small palette ("fewer colors = better pixel art"), layered construction (silhouette, base, details, shading), double-checking coordinates |
| [pixel-art-sprites skill (omer-metin)](https://www.claudemarketplace.net/skills/pixel-art-sprites) and its [sharp edges](https://raw.githubusercontent.com/omer-metin/skills-for-antigravity/main/skills/pixel-art-sprites/references/sharp_edges.md) and [patterns](https://raw.githubusercontent.com/omer-metin/skills-for-antigravity/main/skills/pixel-art-sprites/references/patterns.md) | Palette budgets per subject (props 4-6, characters 8-12, large 12-16), near-duplicate colors (distance under 30), pillow shading, anti-aliasing halos, one outline rule at one cell, near-black or darkest-shade outlines, character proportions, silhouette test, integer scaling and no lossy formats |
| [Pixel Art Professional skill (willibrandon)](https://www.skill-gallery.jp/en/skills/willibrandon/pixel-art-professional) | Hue-shifted ramps (cool shadows, warm highlights), 5-step ramps, no pure black or white, no anti-aliasing at 16x16 and below, ordered over random dithering |
| [Pixel Art Bench](https://huggingface.co/blog/AINovice2005/pixel-art-bench) | Palette plus index-grid output and the finding that structure (row and cell counts) fails more often than syntax, which is why a malformed drawing gets one corrected retry |
| [Aseprite MCP servers](https://github.com/diivi/aseprite-mcp), [pixel-mcp](https://github.com/willibrandon/pixel-mcp) | Character-grid drawing, retro palette presets and palette-conformance measurements; we keep the measurements and presets and skip the editor itself |
| Pixel art tutorials ([Pixel Joint](https://pixeljoint.com/forum/forum_posts.asp?TID=11299&PID=139318), [sprite-ai.art](https://www.sprite-ai.art/guides/pixel-art-fundamentals), [GraphicsGale core techniques](https://amp.ca/learning/pixel-art/pixel-art-2-core-techniques-in-graphicsgale/)) | Jaggies as irregular step lengths, even diagonal runs, banding, orphan cells, workflow order, sizes by canvas |

The classic palettes in `src/lib/pixel-palettes.ts` are widely published value lists. Pixel animation, layers, patches, imported-grid conversion and engine metadata are documented in [the asset workshop](../../docs/asset-workshop.md).

## CAD guidance

CadQuery construction guidance is authored for the pinned runtime using the official [CQGI execution interface](https://cadquery.readthedocs.io/en/stable/cqgi.html), [construction examples](https://cadquery.readthedocs.io/en/stable/examples.html) and [import/export reference](https://cadquery.readthedocs.io/en/stable/importexport.html). The inspect/specify/build/validate workflow and edit-preservation evidence were also evaluated against [AgentCAD's Apache-2.0 skill](https://github.com/jdilla1277/agentcad-skill) and the MIT-licensed [cad-spec-gen](https://github.com/proecheng/cad-spec-gen) and [text-to-cad](https://github.com/cedrickchee/text-to-cad) workflows. Their runtime, commands and generated instructions are not installed by this application. Our prompts preserve the owner's approved contract and independent review; requirements never become optional merely because a geometry operation fails.

## SVG icon workflow

Reviewed 2026-10-19. The [seven-source audit](../../docs/icon-workflow-research.md) records pinned revisions, evidence limits and adopted/rejected ideas. `svg-construction.md` reproduces three Lucide SVG studies under the full notices in `../licenses/lucide-icons__lucide.txt`. SVG prompts adapt recognition-first construction, size-dependent radii, optical balance and controlled candidates from the MIT sources listed in the audit. Their licenses are retained here. No unlicensed skill text, external scripts, logo library or raster tracing pipeline is imported.
