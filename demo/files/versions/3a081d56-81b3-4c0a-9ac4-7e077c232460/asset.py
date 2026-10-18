import bpy, math, random
from mathutils import Vector
import assetkit as kit

# Materials pass: retain the approved refined asset and its hierarchy.
# Working coordinates are Blender Z-up, -Y front; GLB conversion is Y-up, +Z front.
rng = random.Random(PARAMS.get('seed', 1))
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/1cc0d50f-95cd-403d-88f9-1a14a0dc3d91/source.blend')
root = bpy.data.objects.get('Paloma_Sedan')
if root is None:
    raise RuntimeError('Approved Paloma root missing')

# Six independently editable constant-color materials. No texture dependencies.
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

# Secondary join correction, both sides: remove the beltline hook.
# Follow the creased body cross-section while staying forward of the folded arch.
def side_x(z):
    if z < .49: return .845 + (z-.29)/.20*.035
    if z > .83: return .88 - (z-.83)/.10*.015
    return .88
rubber = bpy.data.materials['Paloma_Rubber']
for sign, side in [(-1, 'L'), (1, 'R')]:
    for label, pts in [
        ('RearEdge', [(1.205,.93),(1.09,.884),(.965,.819),(.83,.71),(.745,.57),(.71,.35)]),
        ('Sill', [(-.75,.35),(.30,.35),(.71,.35)])
    ]:
        name = 'DoorSeam_'+label+'_'+side
        old = bpy.data.objects.get(name)
        if old is None: raise RuntimeError('Missing approved seam '+name)
        bpy.data.objects.remove(old, do_unlink=True)
        kit.tube(name, points=[(sign*(side_x(z)+.0015),y,z) for y,z in pts], radii=.0032, segments=4, material=rubber, owner=root)
    for name in ['Handle_Recess_Rear_'+side, 'Handle_Rear_'+side]:
        obj = bpy.data.objects[name]
        obj.location.y -= .14

# Preserve useful wheel names, axle origins and all approved major geometry.
for name in ['wheel_fl','wheel_fr','wheel_rl','wheel_rr']:
    ob = bpy.data.objects[name]
    print('PRESERVED_WHEEL', name, tuple(ob.location), tuple(ob.dimensions))
print('MESHES', [(ob.name, len(ob.data.polygons)) for ob in bpy.data.objects if ob.type == 'MESH' and not ob.name.startswith('Studio')])
finish_asset(material_mode='poly')
