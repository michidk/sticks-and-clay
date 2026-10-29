ASSET TYPE
{{assetType}}

DESIGN REFERENCE
{{design}}

ASSET NAME
{{name}}

ASSET BRIEF
{{request}}

ADDITIONAL WORKSHOP CONTEXT
{{context}}

VISUAL TARGET AND USER REFERENCES
{{evidence}}

Choose exactly one surface strategy in the returned JSON: `image-textures`, `flat-color`, `vertex-colors`, or `procedural-material`. Use `flat-color` or `vertex-colors` when image textures would add noise or cost without improving the approved design. `image-textures` is for purposeful base-color images, and `procedural-material` is for shader or generated values without archived texture images. A plan may have no texture entries. If you do use an image texture only for color, say so in its purpose and give an explicit normal strategy such as "no normal map; keep the surface smooth".

Return a single production plan for this exact asset. Use version 1.
