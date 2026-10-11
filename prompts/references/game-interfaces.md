# Game interfaces (only when requested)

For a requested pixel sprite sheet, render the authored 3D asset rather than
drawing a replacement picture. Use `finish_asset(..., sprites={"directions":8,
"frames":[1,8,16],"size":64,"pixel":True,"colors":16,"outline":"#203628"})`.
An optional `palette` array supplies 2–32 `#rrggbb` colors. Pixel rendering uses
orthographic views, four-times supersampling, camera-relative lighting, one
palette shared across frames/directions and hard alpha. Outlines remain inside
their cell; reserve silhouette padding so they are not clipped. Sheet rows are
frames, columns directions, with direction 0 facing the model's -Y front.

Judge the actual sprites at native size and enlarged without smoothing. Make
primary color regions clearly distinct, thicken fragile appendages, keep the
silhouette readable and inspect animation continuity across views. Detail that
vanishes at 32–64 pixels does not help the delivery. Frame sampling uses authored
timeline poses; name clips and use explicit source frames when more than one
animation is present. A finished GLB can also be exported locally using the
version's sprite controls and downloaded as an offline rebuild bundle.

Keep one named object per moving or replaceable part. Parent through `kit.root`, retain meaningful local pivots and use `_L`/`_R` for mirrored parts. The exporter translates the root to ground center while retaining children, rigs and sockets. Do not flatten the hierarchy or move every part origin to zero.

- `kit.pivot(part, world_position)` puts a hinge, wheel or joint origin where it actually turns. Verify motion; naming a joint is not proof it works.
- `kit.socket("socket_muzzle", world_position, part, forward=(0,-1,0))` creates an attachment node. Blender is Z-up metres, front -Y. After glTF conversion the socket's local +Z points forward. Verify exported orientation.
- `kit.slot(owner, name, socket_name, accepts=[...])` declares interchangeable equipment intent. It does not implement runtime attachment logic.
- `kit.collider(part, shape="convex")` declares convex, box, sphere or mesh collision intent; it does not prove simulated collision fit.
- `kit.grid_piece(part, cells=(x,y,z), cell_size=1)` declares whole-cell dimensions. Size mating faces exactly and inspect shared seams. Metadata does not reshape a part.
- `kit.allow_overlap(a,b,"reason")` records a deliberate seated joint or hidden overlap. Never excuse visible unwanted penetrations. `kit.open_surface(part,"reason")` declares intentional open sheet/foliage geometry; closed props must still be sound.

Animate only when requested. Keyframe actual part transforms or a real armature with meaningful rest pose and axes. `kit.clip(name,start,end,loop=False)` creates named NLA tracks from authored active actions for glTF export. `kit.event(name,frame,owner,socket_name=None)` records contact/gameplay timing. Reference real nodes and in-range frames. Keep sockets on stable transform nodes rather than a deforming morph patch. Inspect start, extrema, contact and loop seam, and report unverified behavior honestly. Preserve source; never simplify rigs or morphs indiscriminately.

For requested sprite output, call `finish_asset(..., sprites={"directions":8,"frames":[1,8,16],"size":128})`. Frames must be within the animation range. This renders a transparent sheet and JSON layout from the actual model. Inspect framing and silhouette; do not add this expensive output to ordinary static props.

For requested static LODs, call `finish_asset(..., lod_ratios=[0.5,0.25])` with up to three ratios between zero and one. Separate GLBs retain the named hierarchy and socket nodes; the original source is unchanged. Check silhouette and UV/material seams after decimation. The helper rejects animated, rigged or morph assets: do not bypass that restriction or promise animation-safe simplification. Ratios are user-requested output choices, not automatic polygon budgets.
