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
