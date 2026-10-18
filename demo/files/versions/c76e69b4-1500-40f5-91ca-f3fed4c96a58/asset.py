import bpy, math, random
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import assetkit as kit

# Surface pass: preserve the approved, refined three-box shell and fixed track.
# Blender metres/Z-up/-Y-front becomes glTF metres/Y-up/+Z-front.
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/16fcc92c-20f6-46f5-ad62-84e323c8b0cd/source.blend')
rng = random.Random(PARAMS.get('seed', 1))
root = bpy.data.objects['Paloma_Sedan']
for ob in list(bpy.data.objects):
    if ob.type in {'CAMERA','LIGHT'}:
        bpy.data.objects.remove(ob, do_unlink=True)

# Explicit poly finish: quiet solid-color satin surfaces, no image dependency.
def linear(v):
    return v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4
palette = {
    'Paloma_BodyPaint': ('55A9B8', .48, .12),
    'Paloma_Glass': ('304A52', .38, 0.),
    'Paloma_Rubber': ('273334', .88, 0.),
    'Paloma_BumperMetal': ('B9C2BE', .48, .70),
    'Paloma_Headlight': ('F2D9A4', .36, 0.),
    'Paloma_Taillight': ('C64E4B', .38, 0.),
}
for name, (hexcolor, roughness, metallic) in palette.items():
    mat = bpy.data.materials[name]
    print('PRIOR_MATERIAL', name, tuple(mat.diffuse_color))
    rgba = tuple(linear(int(hexcolor[i:i+2],16)/255.) for i in (0,2,4)) + (1.,)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    p = nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = rgba
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Alpha'].default_value = 1.
    out = nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(p.outputs['BSDF'], out.inputs['Surface'])
    mat.diffuse_color = rgba
    mat.roughness = roughness
    mat.metallic = metallic
    mat['palette_srgb'] = '#'+hexcolor
    mat['surface_intent'] = 'Opaque color-only PBR; no texture or normal map'

# Repair only the unsupported rear closing seams identified in top/bottom photos.
# Project against the actual inherited shell and radial fender triangles, not an
# analytic circle: interpolation across a body/fender break was bridging air.
verts=[]; faces=[]
deps=bpy.context.evaluated_depsgraph_get()
for ob in bpy.data.objects:
    if ob.name == 'Body_ThreeBox_LowerShell' or ob.name.startswith('Fender_Local_'):
        ev=ob.evaluated_get(deps); me=ev.to_mesh(); me.calc_loop_triangles()
        start=len(verts)
        verts.extend(ob.matrix_world @ v.co for v in me.vertices)
        faces.extend(tuple(start+i for i in tri.vertices) for tri in me.loop_triangles)
        ev.to_mesh_clear()
bvh=BVHTree.FromPolygons(verts, faces, all_triangles=True)

def simplify(points, tolerance=.000015):
    if len(points)<3:return points
    a,b=points[0],points[-1];ab=b-a
    distances=[(p-(a+ab*max(0.,min(1.,(p-a).dot(ab)/ab.length_squared)))).length for p in points[1:-1]]
    maximum=max(distances)
    if maximum<=tolerance:return [a,b]
    k=distances.index(maximum)+1
    return simplify(points[:k+1],tolerance)[:-1]+simplify(points[k:],tolerance)

for side,label in [(-1,'L'),(1,'R')]:
    name='Door_Rear_Joint_'+label
    old=bpy.data.objects.get(name)
    if old:bpy.data.objects.remove(old,do_unlink=True)
    points=[]
    # Inferred fixed-door boundary retained at inherited y=1.03. Terminate just
    # before the inner arch contour at about z=.753; no seam beneath the sill.
    for i in range(181):
        z=.922-(.922-.758)*i/180
        loc,normal,index,distance=bvh.ray_cast(Vector((side*2.,1.03,z)),Vector((-side,0,0)),2.)
        if loc is None or abs(loc.x)<.87:break
        points.append(loc+Vector((side*.0018,0,0)))
    points=simplify(points)
    ob=kit.tube(name,[tuple(p) for p in points],radii=.0025,segments=4,material=bpy.data.materials['Paloma_Rubber'],owner=root)
    ob['construction']='Surface-projected fixed door seam; simplified only within 0.015mm; ends at arch lip'
    print('REPAIRED_SEAM',name,'points',len(points),[tuple(round(v,5) for v in p) for p in points])

# Final rear-view cleanup: sill joints also need samples at the flare transition.
for side,label in [(-1,'L'),(1,'R')]:
    name='Door_Sill_Joint_'+label
    old=bpy.data.objects.get(name)
    if old:bpy.data.objects.remove(old,do_unlink=True)
    points=[]
    for i in range(751):
        y=-.69+( .811+.69)*i/750
        loc,normal,index,distance=bvh.ray_cast(Vector((side*2.,y,.305)),Vector((-side,0,0)),2.)
        if loc is not None and abs(loc.x)>.87:
            points.append(loc+Vector((side*.0018,0,0)))
    points=simplify(points)
    ob=kit.tube(name,[tuple(p) for p in points],radii=.0025,segments=4,material=bpy.data.materials['Paloma_Rubber'],owner=root)
    ob['construction']='Surface-conforming sill seam, retained width, terminated before rear wheel opening'

# Preserve the four inherited moving-part pivots and mesh material slots.
for name in ('wheel_fl','wheel_fr','wheel_rl','wheel_rr'):
    ob=bpy.data.objects[name]
    print('WHEEL',name,'pivot',tuple(ob.matrix_world.translation),'size',tuple(ob.dimensions))
    ob['axle_axis']='X'
    ob['construction']='Approved fixed track, .76m diameter and .25m axial width; retained'
root['pass_record']='Color-only materials pass; actual-face projection of rear door seams; approved fenders and fixed wheel centers preserved'
finish_asset(material_mode='poly')