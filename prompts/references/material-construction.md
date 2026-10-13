Use the supplied pinned API documentation; do not invent functions. The basic entrypoint is materialkit.build_material(params). It returns linear albedo RGB, scalar roughness/metallic/AO/height, encoded OpenGL +Y normal RGB, a millimetre height window, particle count, and warnings. Build parameters are validated. All fields wrap at tile borders.

The result is a dictionary. `albedo` and `normal` are NumPy arrays with shape `(size, size, 3)`; `roughness`, `metallic`, `height` and `ao` have shape `(size, size)`. All channel arrays are finite and in [0,1]. `heightWindowMm` is the pair `[minimum_mm, maximum_mm]`, not a scalar. Decode physical height with `lo, hi = result['heightWindowMm']; height_mm = lo + result['height'] * (hi - lo)`. `particles` is a count and `warnings` is a list of strings. `derive_surface(height_mm, tile_metres)` returns the tuple `(encoded_normal, ao)`, not a material dictionary. Copy arrays before changing them if the original result must remain available for layer composition.

Feature pixels = featureMm / (tileMetres * 1000 / size). Features smaller than roughly 1.5 pixels are aggregate surface variation, not individually resolved objects. Preserve physical dimensions; only exaggerate when the approved style asks for it. Quick previews may have lower resolution; only final-resolution evidence establishes fine detail.

Color, roughness, height and metallic masks must describe the same feature. Dirt in gaps changes intrinsic material color and roughness; it is different from painting directional shadows into albedo. Keep diffuse paint dielectric and exposed metal metallic. Zero wear should leave paint intact. Distinguish constructed appearance from measured calibration; no scan-quality claims without supplied measurement evidence.

Use seeded periodic fields to vary an identified process. Never add edge gradients or cropped nonperiodic features. Judge repeated tiles for conspicuous recurring marks as well as seams. Keep the quiet areas requested by the design.
# Composition primitives

The facade also exports `noise(size, seed, scale)`, `fracture_mask(size, seed, cells, width=.05)`, `layer(base, coating, mask, tile_metres)`, and `derive_surface(height_mm, tile_metres)`. `layer` uses the same [0,1] mask for color, roughness, metal, and physical height, then recomputes normals and local cavity AO. Masks must match the square map dimensions. Use these APIs for connected regions instead of unrelated per-channel noise. Keep the source parameters immutable.

These examples are executable construction patterns, not evidence that a requested feature has been visually verified. Adapt their masks to the actual brief.

Partially buried gravel over fines, with sparse shallow dirt filling low gaps (use gravel parameters):

```python
import numpy as np
from materialkit import build_material, check, noise, layer

def build(params):
    params = check(params)
    base = build_material(params)
    lo, hi = base['heightWindowMm']
    gaps = np.clip((np.quantile(base['height'], .35) - base['height']) * 8, 0, 1)
    patches = np.clip(noise(params['size'], params['seed'] + 9, 4) - .4, 0, 1)
    mask = gaps * patches
    dirt = dict(base)
    dirt['albedo'] = base['albedo'] * .7
    dirt['roughness'] = np.clip(base['roughness'] + .1, 0, 1)
    dirt['height'] = np.clip(base['height'] + .25 / (hi - lo), 0, 1)
    return layer(base, dirt, mask, params['tileMetres'])
```

Paint over metal, retaining intact regions around the recipe's chips and scratches (use painted-metal parameters):

```python
import numpy as np
from materialkit import build_material, check, noise, layer

def build(params):
    params = check(params)
    intact = build_material({**params, 'wear': 0})
    worn = build_material(params)
    exposed_region = np.clip(.5 + .4 * noise(params['size'], params['seed'] + 31, 3), 0, 1)
    return layer(intact, worn, exposed_region, params['tileMetres'])
```
