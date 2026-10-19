import bpy, math, random
from mathutils import Vector
import assetkit as kit

# Hollowmere mortar: persisted silhouette/blockout pass, metres, front -Y.
rng = random.Random(PARAMS.get('seed', 1))
root = kit.root('Mortar_Root')
stone = kit.color_material('stone_warm_gray_clay', (.36,.325,.275,1), roughness=.88)
brass = kit.color_material('aged_brass_clay', (.42,.27,.095,1), roughness=.72)

# A single closed radial surface travels from sole, over the foot and lip,
# then down the real concave grinding surface to its central floor.
profile = [(0,0),(.058,0),(.067,.003),(.070,.011),(.069,.018),
 (.063,.024),(.057,.027),(.067,.034),(.078,.047),(.088,.065),
 (.096,.087),(.100,.108),(.101,.128),(.099,.137),(.094,.140),
 (.084,.140),(.079,.135),(.078,.124),(.074,.105),(.067,.085),
 (.055,.065),(.039,.052),(.020,.047),(0,.046)]
N=32
verts=[]
for j,(r,z) in enumerate(profile):
    for i in range(N):
        a=2*math.pi*i/N
        # Quiet asymmetry; sole stays flat and rim remains thick.
        wobble=(.0007*math.sin(3*a+.5)+.0004*math.cos(7*a)) if r else 0
        zz=z
        if 12<=j<=17: zz += .0011*math.sin(3*a+.5)+.0005*math.cos(5*a)
        verts.append(((r+wobble)*math.cos(a),(r+wobble)*math.sin(a),zz))
faces=[]
for j in range(len(profile)-1):
    for i in range(N):
        k=(i+1)%N
        faces.append((j*N+i,j*N+k,(j+1)*N+k,(j+1)*N+i))
mesh=bpy.data.meshes.new('mortar_continuous_profile_mesh')
mesh.from_pydata(verts,[],faces); mesh.update()
body=bpy.data.objects.new('mortar_body',mesh); bpy.context.collection.objects.link(body)
body.parent=root; body.data.materials.append(stone)
# Weld axial vertices rather than retaining collapsed quads.
bpy.context.view_layer.objects.active=body; body.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=.00001); bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT'); body.select_set(False)

# Small repair strap wraps only the front-left portion, leaving quiet stone.
# Closed shaped strip conforms to the bowl's changing radius.
vs=[]; fs=[]; steps=12
for rad_offset in (0,.0018):
    for z,r in ((.098,.0988),(.114,.1008)):
        for i in range(steps+1):
            a=math.radians(-145+55*i/steps)
            vs.append(((r+rad_offset)*math.cos(a),(r+rad_offset)*math.sin(a),z))
s=steps+1
for i in range(steps):
    fs.extend([(i,i+1,s+i+1,s+i),(2*s+i,3*s+i,3*s+i+1,2*s+i+1),
               (i,2*s+i,2*s+i+1,i+1),(s+i,s+i+1,3*s+i+1,3*s+i)])
fs.extend([(0,s,3*s,2*s),(steps,2*s+steps,3*s+steps,s+steps)])
me=bpy.data.meshes.new('repair_band_curved_mesh'); me.from_pydata(vs,[],fs); me.update()
band=bpy.data.objects.new('mortar_repair_band',me); bpy.context.collection.objects.link(band)
band.parent=root; band.data.materials.append(brass)
kit.bevel(band,width=.0006,segments=1)

# Separate selectable tool assembly. Local origin is lower grinding-tip centre;
# local Z is its lifting axis; X/Y are tilt axes.
pestle=kit.root('Pestle'); pestle.parent=root
pestle.location=(.006,.002,.064)
pestle.rotation_euler=(math.radians(-12),math.radians(25),0)
pp=[(.004,-.018),(.011,-.016),(.020,-.010),(.024,0),(.024,.013),
 (.021,.028),(.018,.052),(.015,.093),(.015,.128),(.020,.136),
 (.025,.145),(.025,.156),(.020,.165),(.010,.169),(.003,.170)]
tool=kit.lathe('pestle_stone',pp,segments=16,material=stone,owner=pestle)
collar=kit.lathe('pestle_brass_collar',[(.0155,.121),(.017,.123),(.017,.132),(.016,.134)],segments=16,material=brass,owner=pestle)
# Helpers retain world transforms on parenting; these profiles are authored
# in assembly-local coordinates, so explicitly restore their local frame.
from mathutils import Matrix
for child in (tool,collar):
    child.matrix_parent_inverse=Matrix.Identity(4)
    child.matrix_basis=Matrix.Identity(4)
    child.scale.z=1.12
if 'asset_root' in pestle: del pestle['asset_root']
# Representative transform exercise with all attached objects retained.
rest_loc=pestle.location.copy(); rest_rot=pestle.rotation_euler.copy()
for axis in (0,1):
    pestle.rotation_euler[axis]+=math.radians(10)
    bpy.context.view_layer.update()
    assert tool.parent==pestle and collar.parent==pestle
    pestle.rotation_euler=rest_rot.copy()
pestle.location += pestle.rotation_euler.to_matrix() @ Vector((0,0,.04))
bpy.context.view_layer.update()
pestle.location=rest_loc; pestle.rotation_euler=rest_rot
bpy.context.view_layer.update()
root['pass']='blockout'
root['dimensions_intent']='mortar diameter .20m, rim height .14m, total approx .24m'
pestle['pivot_intent']='lower grinding tip centre; local X/Y tilt, local Z lift'
root['remaining_work']='Refine contact, rim wear, repair ends and tool marks; UVs and textures deferred.'
finish_asset(material_mode='poly')