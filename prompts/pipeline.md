# Reusable prompt: coherent game asset pack

Copy the prompt below and replace the bracketed inputs. Keep the tree-specific
section when making trees; omit it for other asset families.
Keep the building-specific section when making architecture packs.

---

Create a production-ready 3D game asset pack in Blender.

**Inputs**

- Asset family: [for example, low-poly temperate trees]
- Number of distinct assets: [count]
- Intended game style and setting: [description or reference images]
- Working scale: [target height or dimensions in meters]
- Triangle budget per asset: [optional user-specified maximum; omit this line when absent]
- Material mode: [textured, the default, or poly mode]
- Export format: one binary glTF (.glb) per asset, plus a master .blend file
- Preview environment: [local or managed preview name, if applicable]

**Plan briefly before building.** Name the assets and explain the role and
silhouette of each. Write a compact style specification covering proportions,
shape language, palette, material roughness, texture detail, and scale. Choose
one asset as the reference prototype. Build and render it first, inspect it,
then use its proportions, material treatment, and lighting as the reference
for the remaining assets. Make distinct silhouettes without drifting from the
shared style.

**Model and export requirements**

1. Use real-world units consistently. Keep intended sizes comparable; if an
   exact common height is requested, normalize every asset to that height.
2. Place each asset's local origin at the center of its ground-contact
   footprint, with the lowest geometry at local ground level. Export without
   scene lineup offsets baked into the GLB.
3. Use enough facets to read well at game camera distance while staying under
   any explicitly requested triangle budget. Prefer clean silhouettes and readable major forms over
   tiny geometry.
4. UV-map every textured mesh and use named, reusable materials. In textured
   mode, include base-color and tangent-space normal maps. Embed the maps in
   each GLB and pack them into the master .blend file.
5. In poly mode, use solid material colors or a color-index palette only. Do
   not include image textures or normal maps.
6. Keep each asset independently importable as its own .glb. Deliver the
   master .blend source and deterministic build instructions.

**Tree-specific guidance**

- Pick recognizable species with complementary silhouettes, such as a wide
  deciduous canopy, a tiered conifer, an airy pale-barked tree, a warm-color
  accent, and a narrow evergreen. Adapt the species to the setting.
- Keep trunk thickness, branching height, crown density, and canopy width
  plausible relative to the shared height. Branches should visibly support
  foliage, with junctions concealed or deliberately modeled.
- Give foliage intentional masses and gaps; avoid a repeated sphere stamp or
  identical clump positions. Check each tree from multiple angles.
- Bark should read as natural variation at game distance. Use irregular,
  broken grain and subtle roughness. Avoid uniform vertical pinstripes,
  checker/plaid noise, and horizontal bands that wrap the whole trunk.
- For birch-like bark, use sparse, short lenticel marks rather than evenly
  spaced rings. Inspect the bark on the actual trunk and branches, not just
  the texture image. Reduce normal-map strength if it makes facets look noisy.
- Apply the texture lesson from the Fieldwood prototype: repeated sine-wave
  grain became obvious vertical striping on cylindrical UVs, and full-width
  horizontal marks became rings around birch trunks. Replace those patterns
  with irregular multi-scale noise and short, disconnected marks. Check the
  result on the exported GLB at both game-camera distance and close range;
  the flat texture image alone is not enough. Fix UV scale and normal-map
  intensity before multiplying the design into variants.
- Keep foliage and bark in one shared style family, even when species have
  different colors. Check the set together at equal scale.

**Building and castle-specific guidance**

- Choose pieces by their scene role, such as wall, tower, entrance, landmark,
  and dwelling. Give each a different roofline and massing while keeping a
  common construction language, palette, and module/grid scale.
- Build a prototype first and inspect it at game camera distance. If it reads
  as a plain box, improve its silhouette, openings, roof, and trim before
  generating variations. Do not multiply a weak template.
- Make windows, doors, battlements, stairs, and roof details large enough to
  survive downscaling. Avoid tiny surface noise as a substitute for form.
- Check roofs, parapets, and openings for coincident faces, visible gaps,
  light leaks, and clipping from at least two camera angles.
- For a non-poly castle set, cut functional openings into the wall geometry.
  Give arrow slits, doors, and gates jamb and soffit depth; a dark rectangle
  placed on a solid wall is insufficient. Model arch voussoirs as volume.
- Make battlements part of a plausible parapet and wall walk. Vary wear and
  stone sizes without changing the shared module datum. Add roof access and
  drainage details where tower decks are visible.
- Assemble at least two adjacent modules on the intended grid and inspect the
  seam from front, back, and above. Keep end caps and buttresses within the
  join tolerance; avoid coincident faces at side and base trim.
- For variations, change structural features such as roof type, tower count,
  openings, annexes, dormers, and height. Scaling a fixed template alone does
  not make a useful set of architectural variations.

**Finish and verify**

Create at least one scale lineup and one in-context demo scene, then render
both and a product view of every asset. Build a small web preview that shows
the renders, offers an orbit/zoom 3D viewer for the delivered GLBs, compares
assets at scale, and provides downloads. Verify that every GLB opens, has
ground-level origin and correct dimensions, stays under any explicitly requested budget, and contains
the expected material maps for its mode. Visually inspect the prototype, the
whole lineup, and the browser preview at desktop and phone width. Correct
visible issues before presenting the pack.

Report the preview link, asset paths, size and triangle counts, and any
remaining limitations.

Record the start and finish times. Estimate model cost from input and output
tokens using the current published rate for the actual model: `(input tokens ×
input rate + output tokens × output rate) / 1,000,000`. If usage metadata is
missing or reports zero, state a reasoned token-count assumption and range;
do not present the zero API call count as zero model cost. Separate local
Blender/render time and any image-generation charges from model-token cost.

**When generating variations**

Use a small, named set of parameters and fixed seeds so every variant can be
reproduced. For trees, vary trunk lean, crown width and height, branch
direction, clump placement, and foliage density. For buildings, vary structure
and silhouette as described above. Change shape
before color; simple recolors are not distinct assets. Keep ground-level
origins, scale, texture treatment, and any explicitly requested triangle limits locked across the
variant set. Export each variant separately, then render a contact sheet to
check repetition, clipping, and style drift before adding them to the preview.
If Blender Geometry Nodes is requested, build a real editable node group
with exposed controls and seed, keep live modifiers in the source .blend,
and export applied copies to GLB. Confirm that changing the controls produces
different geometry, and validate the exported shapes as well as the node
group's presence in the source file.

---

In this workspace, the current implementation is in pipeline/build_trees.py;
README.md documents its commands and delivered files.
