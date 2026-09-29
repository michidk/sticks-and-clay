"""BMesh topology on raw decoded GLB arrays; never import, validate or save a model."""
import bmesh, json, math, sys
args = sys.argv[sys.argv.index('--') + 1:]
with open(args[0]) as source:
    objects = json.load(source)
for obj in objects:
    vertices = [[float(c) for c in v] for v in obj['vertices']]
    if not all(math.isfinite(c) for v in vertices for c in v):
        continue
    bm = bmesh.new()
    try:
        lookup = {}
        for v in vertices:
            key = tuple(v)
            if key not in lookup:
                lookup[key] = bm.verts.new(v)
        for index, tri in enumerate(obj['faces']):
            vs = [lookup[tuple(vertices[i])] for i in tri]
            try:
                face = bm.faces.new(vs)
                face.index = index
            except ValueError:
                pass  # Raw duplicate/degenerate faces remain in obj for Trimesh.
        for name, predicate in [('open_boundary', lambda e: e.is_boundary), ('non_manifold', lambda e: len(e.link_faces) > 2)]:
            edges = [e for e in bm.edges if predicate(e)]
            obj['topology'][name] = {'count': len(edges), 'faces': sorted({f.index for e in edges for f in e.link_faces})[:20]}
    finally:
        bm.free()
with open(args[1], 'w') as output:
    json.dump(objects, output)
