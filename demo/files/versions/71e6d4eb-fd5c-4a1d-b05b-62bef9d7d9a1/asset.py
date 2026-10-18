import bpy, math, random
from mathutils import Vector
import assetkit as kit

# Polish: preserve the supplied editable baseline and its named hierarchy.
# Blender Z-up, -Y forward converts to requested glTF Y-up, +Z forward.
rng = random.Random(PARAMS.get('seed', 1))
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/3a081d56-81b3-4c0a-9ac4-7e077c232460/source.blend')
root = bpy.data.objects.get('Paloma_Sedan')
if root is None:
    raise RuntimeError('Approved Paloma root missing')

# Constant-color palette, intentionally no image/UV dependency.
def linear_channel(c):
    return c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4
specs = {
 'Paloma_BodyPaint': ('55A9B8', .48, .12),
 'Paloma_Glass': ('304A52', .38, 0),
 'Paloma_Rubber': ('273334', .88, 0),
 'Paloma_BumperMetal': ('B9C2BE', .48, .70),
 'Paloma_Headlight': ('F2D9A4', .36, 0),
 'Paloma_Taillight': ('C64E4B', .38, 0),
}
for name, (hx, roughness, metallic) in specs.items():
    mat = bpy.data.materials[name]
    rgba = tuple(linear_channel(int(hx[i:i+2],16)/255) for i in (0,2,4)) + (1,)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    p = nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = rgba
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Alpha'].default_value = 1
    if 'Transmission Weight' in p.inputs: p.inputs['Transmission Weight'].default_value = 0
    if 'Emission Strength' in p.inputs: p.inputs['Emission Strength'].default_value = 0
    out = nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(p.outputs['BSDF'], out.inputs['Surface'])
    mat.diffuse_color = rgba
    mat.roughness = roughness
    mat.metallic = metallic
    print('FINAL_MATERIAL', name, hx, roughness, metallic)

# Rear-door junction polish: a single monotonic path, with vertices at body
# cross-section breaks so the narrow seam remains seated rather than bridging.
# These secondary path positions are authored/inferred, not concept measurements.
def side_x(z):
    if z < .49: return .845 + (z-.29)/.20*.035
    if z > .83: return .88 - (z-.83)/.10*.015
    return .88
rubber = bpy.data.materials['Paloma_Rubber']
for sign, side in [(-1,'L'),(1,'R')]:
    name = 'DoorSeam_RearEdge_'+side
    old = bpy.data.objects[name]
    bpy.data.objects.remove(old, do_unlink=True)
    path = [(1.205,.93),(1.065,.88),(.984,.83),(.935,.80),(.83,.69),(.755,.54),(.743,.49),(.71,.35)]
    seam = kit.tube(name, points=[(sign*(side_x(z)+.0015),y,z) for y,z in path], radii=.0028, segments=4, material=rubber, owner=root)
    # Absolute positions avoid applying an accumulating offset to revised sources.
    bpy.data.objects['Handle_Recess_Rear_'+side].location.y = .72
    bpy.data.objects['Handle_Rear_'+side].location.y = .717
for name in ['wheel_fl','wheel_fr','wheel_rl','wheel_rr']:
    ob = bpy.data.objects[name]
    print('PRESERVED_WHEEL', name, tuple(ob.location), tuple(ob.dimensions))
print('MESHES', [(ob.name, len(ob.data.polygons)) for ob in bpy.data.objects if ob.type == 'MESH' and not ob.name.startswith('Studio')])
finish_asset(material_mode='poly')