# Model export processing

Every new builder iteration passes through deterministic local post-processing before its GLB is archived, photographed or published. The ordered passes live in `src/modules/glb/handover.ts`; no AI request or token cost is involved. The first pass replaces `asset.generator` with `Sticks & Clay` and removes known exporter-identification keys from glTF extras (including Blender metadata). Copyright/license attribution, semantic names, custom properties, functional extensions and binary mesh/texture chunks are preserved.

Each version stores a `handover.json` receipt with pass versions, input/output SHA-256 hashes and sizes. The published byte metric reflects the processed file. Malformed GLBs fail before publication and can be repaired through the normal builder resume path. Published historical archives retain their original bytes and photography hashes.

Model photography now provides seven review images: front/rear three-quarter, detail, both sides, top and underside (studio floor hidden for the underside). The judge receives these exact validated archived images, followed by the visual target and user references, with dynamic numbered labels. Planner, builder, model photographer and judge receive user reference images; project-cover photography receives them too. Existing photographer sessions retain their three-view contract on resume. Collection covers still use three presentation views.

## Deterministic model findings and safe export cleanup

The existing judge handler runs read-only analysis of the exact archived GLB used
for photography. Its JSON report (including GLB SHA-256, object names, sampled
original GLB node/mesh/primitive triangle IDs, counts and coverage limitations) is included in the
persisted judge input. There is no new stage or pass/fail gate. Missing tools or
timeouts are reported as unavailable evidence, not a clean model.

- `src/modules/model-analysis/extract.ts`: glTF-Transform decodes original GLB
  accessors without importing through Blender or repairing invalid faces. Each
  texture slot is checked against its actual UV set, including texCoord overrides.
- `blender/analyze_extract.py`: BMesh checks exact-position topology copies of
  those raw arrays so UV/normal seams do not appear as holes.
- `blender/analyze_mesh.py`: Trimesh checks degenerate/duplicate triangles, winding,
  inverted closed shells, tiny islands, collapsed/missing textured UVs and extreme
  extents. libigl CGAL uses `detect_only=True` for within-object self-intersections
  on meshes up to 100,000 triangles without duplicate/degenerate faces. It stops
  at the first intersection; its count is explicitly marked as a lower bound.
  Fast findings are saved atomically before CGAL and after each intersection check;
  native failures/timeouts preserve partial evidence. Missing BMesh does not prevent
  the raw geometry and UV checks.
- `src/modules/model-analysis/`: bounded subprocess adapter (90s Blender, 60s analysis).
  Install `blender/requirements.txt` in `.venv`; `BLENDER_BIN` and `ANALYSIS_PYTHON`
  can override executable paths. Open boundaries and islands may be intentional.
  Cross-object intersections, near-coplanar Z-fighting, density budgets, UV tiling
  and shading-normal heuristics are deliberately not inferred. Exact coincident
  triangles are reported. Findings are capped at 80 with 20 face samples each.

At the existing per-export archive handoff, `src/modules/glb/cleanup.ts` uses
glTF-Transform to weld bitwise-equivalent vertices, simplify large opaque triangle
meshes toward 50% of their original triangles within a 0.1% geometric-error limit,
deduplicate accessors and prune unused resources after index optimization, including
its replaced accessors. Meshoptimizer keeps mesh borders locked during simplification
and reorders opaque triangle indices. Small and transparent meshes are not simplified;
transparent exports also skip reordering. Texture image bytes, UV/normal seams,
materials and scene nodes are preserved. Extensions, skins, animations, morph targets,
non-triangle primitives, URI resources and unknown chunks bypass cleanup; exceptions
fall back to the input. No repair, quantization or lossy texture compression is
performed. The handover receipt records cleanup steps, pre/post triangle counts or the
skip reason before applying the tool's generator marker; published metrics use the
post-cleanup triangle count.
Cleanup precedes immutable photography, so the judge and download see the same
model. Old archived versions are never rewritten.

Tests: `bun test src/modules/glb`, and
`.venv/bin/python -m unittest discover -s blender -p 'test_analy*.py'`.
Set `BLENDER_BIN` to also run the real import/BMesh regression test and
`bun test src/modules/model-analysis` for the subprocess adapter integration test.
