"""Stable public material construction facade for archived scripts."""
if __package__:
    from .materialcore import VERSION, RECIPES, linear, srgb, noise, check, scatter, fracture_mask, derive_surface, layer
    from .materialrecipes import build_material
    from .materialoutput import save, seam_ratio, shade, image
else:
    from materialcore import VERSION, RECIPES, linear, srgb, noise, check, scatter, fracture_mask, derive_surface, layer
    from materialrecipes import build_material
    from materialoutput import save, seam_ratio, shade, image

__all__ = ['VERSION', 'RECIPES', 'linear', 'srgb', 'noise', 'check', 'scatter', 'fracture_mask', 'derive_surface', 'layer', 'build_material', 'save', 'seam_ratio', 'shade', 'image']
