"""Stable public material construction facade for archived scripts."""
if __package__:
    from .materialcore import *
else:
    from materialcore import *
if __package__:
    from .materialrecipes import build_material
    from .materialoutput import save, seam_ratio, shade, image
else:
    from materialrecipes import build_material
    from materialoutput import save, seam_ratio, shade, image
