## Intent: logo

This asset is a logo or brand mark. Make one distinctive, simple mark that reproduces cleanly from favicon size to signage, not a detailed picture of an object.

- Canvas: use the viewBox the approved design gives; default to a square 1024×1024 canvas with the mark centered and visible ink inside roughly 8..92% on both axes. Do not use a 24-unit icon grid unless the design asks for one.
- Reduce the idea to a few strong shapes and keep negative space deliberate. Counters, gaps and thin strokes must stay open at 64 px and 16 px.
- It must work in one color. Let shape carry the identity and add color as a finish, using only the approved palette. Use `currentColor` only when the design asks for a themeable mark.
- Build from a consistent system: one stroke weight, shared radii and a few repeated angles or arcs. Align shapes to a shared grid or optical axis and balance the mark optically, not just geometrically.
- Prefer geometric primitives and clean paths. Avoid gradients, shadows and fine texture unless the design calls for them; they rarely survive reproduction.
- Avoid live text. A wordmark or lettering in a logo should be drawn as paths so it renders the same everywhere. If the request needs readable text, use `font-family="sans-serif"`, set `text-anchor` for alignment and keep it short, and say in the plan that the text is live.
- For a mark with a symbol and a wordmark, give each its own named `g` and keep clear space between them.
