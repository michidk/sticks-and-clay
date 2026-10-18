Use CadQuery's pinned API. Build a bracket from a base and perpendicular flange, place them by explicit dimensions, unite only where one solid is intended, and cut mounting holes using a face workplane and pushPoints. An enclosure starts as a box with a deliberately selected face removed by shell; preserve the requested wall thickness. A turned part uses a closed profile and revolve; pockets use cutBlind or cutThruAll with the intended depth. A circular hole pattern uses measured centres rather than copied guesses. Add fillets after the topology they depend on is established, with selective edge queries and the specified radius.

For a 40×30×10 block with one 6 mm through-hole:
```python
import cadquery as cq
width, depth, height, bore = 40.0, 30.0, 10.0, 6.0
result = cq.Workplane("XY").box(width, depth, height).faces(">Z").workplane().hole(bore)
show_object(result, options={"name": "body"})
```
For debugging, split long chains into named intermediate shapes, examine selection counts and fix the first failed geometric assumption. Empty selectors, invalid wires, oversized fillets and coincident Boolean surfaces are different failures. Never catch every exception and deliver a simplified substitute. Preserve exact dimensional intent; alternative construction should produce the same intended feature.

STEP is the checked CAD interchange artifact; STL and GLB are tessellated derivatives. Export quality, source BRep validity and requested-feature checks are separate evidence. Preserve a common coordinate system between edits so differences remain measurable. The runner validates the STEP round trip and mesh closure and supplies seven orthographic/isometric photographs. Missing or untested evidence is unknown, not a pass.
