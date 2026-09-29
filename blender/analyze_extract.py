"""Read-only GLB inspection in a disposable Blender process. Never saves a blend/GLB."""
import bpy, bmesh, json, sys
args = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args[0])
objects = []
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH':
        continue
    mesh = obj.data
    mesh.calc_loop_triangles()
    vertices = [list(obj.matrix_world @ v.co) for v in mesh.vertices]
    # Exact-position topology copy removes import splits at UV/normal seams only.
    bm = bmesh.new()
    lookup = {}
    for v in vertices:
        key = tuple(v)
        if key not in lookup:
            lookup[key] = bm.verts.new(v)
    for tri in mesh.loop_triangles:
        vs = [lookup[tuple(vertices[i])] for i in tri.vertices]
        try:
            face = bm.faces.new(vs)
            face.index = tri.index
        except ValueError:
            pass  # Duplicate/degenerate triangles are analyzed separately.
    topology = {}
    for name, predicate in [('open_boundary', lambda e: e.is_boundary), ('non_manifold', lambda e: len(e.link_faces) > 2)]:
        edges = [e for e in bm.edges if predicate(e)]
        topology[name] = {'count': len(edges), 'faces': sorted({f.index for e in edges for f in e.link_faces})[:20]}
    bm.free()
    order = [0, 2, 1] if obj.matrix_world.determinant() < 0 else [0, 1, 2]
    uv = mesh.uv_layers.active
    objects.append({'name': obj.name, 'vertices': vertices,
        'faces': [[t.vertices[i] for i in order] for t in mesh.loop_triangles],
        'polygons': [t.polygon_index for t in mesh.loop_triangles],
        'uv': [[list(uv.data[i].uv) for i in [t.loops[k] for k in order]] for t in mesh.loop_triangles] if uv else None,
        'textured': [bool(mesh.materials[t.material_index] and mesh.materials[t.material_index].use_nodes and any(n.type == 'TEX_IMAGE' for n in mesh.materials[t.material_index].node_tree.nodes)) if t.material_index < len(mesh.materials) else False for t in mesh.loop_triangles],
        'topology': topology})
with open(args[1], 'w') as f:
    json.dump(objects, f)
