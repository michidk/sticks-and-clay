# Sprite output contract (takes precedence over ordinary texture requirements)

This job delivers sprites from the authored 3D model. The fixed spriteTarget parameters are in PARAMS; finish_asset automatically renders that target. Inspect preview_sprites after drafts and sprites after final export. The final pixel size, camera, palette, directions and motion determine visual acceptance. Do not judge only the beauty renders.

Intentional matte color regions are valid for this target. Use finish_asset(material_mode="poly") when those regions meet the design; the ordinary requirement to generate and bind image textures does not apply unless the brief explicitly requires a textured GLB too. Do not generate noisy textures just to satisfy the ordinary model workflow. Preserve useful 3D construction and animation.

Develop silhouette and negative space at native size. Where the approved style allows, thicken details that disappear or flicker and separate similar color regions. Do not impose oversized heads, saturation, or nonmetallic surfaces on every design. Geometry-stage temporary materials remain valid.

Use the requested animation clip and one consistent cycle convention: author the terminal repeat at the end of a looping range; the renderer excludes that terminal sample. For one-shot motion the endpoint is included. Preserve contact, pivots, and hierarchy.

Review native size before enlarged cells. Compare every delivered direction for consistent proportions, attachments, handedness and palette. Inspect contact/extreme poses and last-to-first transition for popping, disappearance and clipping. Cite direction and source frame in findings. Technical topology warnings alone do not reject intentionally sprite-only hidden geometry, but explicit source-model requirements still apply. Do not approve unseen cells from a few selected poses.
