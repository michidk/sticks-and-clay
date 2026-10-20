## Intent: icon

This asset is a UI icon or a member of an icon set, drawn for small display. Recognition at small size comes first; detail that does not survive 64 px does not belong.

Study the attached construction reference before drawing. Borrow contour and junction techniques, not unrelated subject shapes or an unrequested style.

Keep the subject clear at 64 px and, when those sizes are requested, at 24 px and 16 px. Compare the supplied 24px and 64px previous renders during repairs.

## Icon scale and shared construction

For UI icons, use the shared icon construction in the asset brief. Preserve its exact viewBox, palette, weight, radii and bounds. If no shared specification exists, use the grid and weight requested by the approved design; default unspecified UI geometry to viewBox="0 0 24 24", visible ink inside 2..22 on both axes. For line construction, default to a 2-unit stroke; use roughly 2-unit radii on large rounded parts, 1-unit radii on small parts, and sharp identifying edges. Do not add outlines to every filled part. Do not convert a 24-unit icon to a 1024-unit illustration. Raster preview dimensions are not SVG coordinates. Explicit design requirements override these defaults.

Account for half the stroke width on each side of a contour when sizing fills and openings. A narrow filled handle needs enough interior width left after its outline. Simplify or enlarge meaningful openings instead of letting thick strokes consume them. Compare the supplied 24px and 64px previous renders during repairs; a clean enlarged drawing alone is insufficient.

## Outline icons

- Draw each continuous contour as one path rather than several capped lines. Close genuinely closed contours with Z. Keep intentional open contours open: Z adds a straight segment back to the start and can create an unwanted diagonal.
- Draw shared edges once. Do not stack two outlines along the same edge or retrace a segment to repair it. At a join, share exact coordinates; rounded caps extend beyond their endpoints, so two separate capped strokes can leave bumps even when their coordinates match.
- Keep junctions simple. For lids, rims, spouts and handles, decide which edges are visible and omit the hidden edges. A transparent fill does not hide strokes underneath it. Do not paint over mistakes with a background-colored patch; the SVG must work on other backgrounds.
- Give stroked elements stable descriptive ids. Use one inherited stroke width, cap and join unless the approved design requires variation. Keep fine-line icons at the approved weight, not thicker to hide bad joins.
- Before returning, trace every contour and inspect every endpoint and junction. Remove overshoots, tiny extra segments, duplicate edges and unintended closing lines. Check the silhouette at the requested size, including 24 px when this is a UI icon.

When asked to explore silhouettes, make only the assigned construction alternative. Resolve the primary contour, connected parts and identifying openings at 16px and 24px before ornament. Keep the approved palette and weight. Return one complete editable SVG, preserve alternatives as separate assets, and do not choose a winner or polish another candidate. The owner selects the candidate to refine.
