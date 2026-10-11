Use the supplied pinned API documentation; do not invent functions. The basic entrypoint is materialkit.build_material(params). It returns linear albedo RGB, scalar roughness/metallic/AO/height, encoded OpenGL +Y normal RGB, a millimetre height window, particle count, and warnings. Build parameters are validated. All fields wrap at tile borders.

Feature pixels = featureMm / (tileMetres * 1000 / size). Features smaller than roughly 1.5 pixels are aggregate surface variation, not individually resolved objects. Preserve physical dimensions; only exaggerate when the approved style asks for it. Quick previews may have lower resolution; only final-resolution evidence establishes fine detail.

Color, roughness, height and metallic masks must describe the same feature. Dirt in gaps changes intrinsic material color and roughness; it is different from painting directional shadows into albedo. Keep diffuse paint dielectric and exposed metal metallic. Zero wear should leave paint intact. Distinguish constructed appearance from measured calibration; no scan-quality claims without supplied measurement evidence.

Use seeded periodic fields to vary an identified process. Never add edge gradients or cropped nonperiodic features. Judge repeated tiles for conspicuous recurring marks as well as seams. Keep the quiet areas requested by the design.
# Composition primitives

The facade also exports `noise(size, seed, scale)`, `fracture_mask(size, seed, cells, width=.05)`, `layer(base, coating, mask, tile_metres)`, and `derive_surface(height_mm, tile_metres)`. `layer` uses the same [0,1] mask for color, roughness, metal, and physical height, then recomputes normals and local cavity AO. Masks must match the square map dimensions. Use these APIs for connected regions instead of unrelated per-channel noise. Keep the source parameters immutable.
