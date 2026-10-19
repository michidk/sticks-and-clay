import bpy, math, random
from mathutils import Vector
import assetkit as kit
rng=random.Random(PARAMS.get('seed',1))
# Refinement: load the archived blockout, retaining identities and transforms.
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/7dacdbc1-a1a9-473c-934a-081c8882a2bb/source.blend')
root=bpy.data.objects['Cauldron_Root']; pot=bpy.data.objects['pot_shell']; stand=bpy.data.objects['tripod_assembly']; bail=bpy.data.objects['bail_assembly']
original={o.name:(o.parent.name if o.parent else None) for o in bpy.context.scene.objects if o.type in {'MESH','EMPTY'}}
copper=bpy.data.materials['pot_copper_matte']; edge=bpy.data.materials['rolled_copper_edge']; iron=bpy.data.materials['tripod_forged_iron']; brass=bpy.data.materials['bail_grip_aged_brass']
def geometry(name,verts,faces,mat=None,owner=None):
    ob=bpy.data.objects.get(name)
    if ob is None:
        ob=bpy.data.objects.new(name,bpy.data.meshes.new(name+'_mesh')); bpy.context.collection.objects.link(ob)
        ob.parent=owner; bpy.context.view_layer.update()
    if mat is None: mat=ob.data.materials[0]
    bpy.context.view_layer.update()
    transform=ob.matrix_world.inverted() @ root.matrix_world
    me=bpy.data.meshes.new(name+'_refined_mesh'); me.from_pydata([tuple(transform@Vector(v)) for v in verts],[],faces); me.materials.append(mat); me.update()
    old=ob.data; ob.data=me
    if old.users==0: bpy.data.meshes.remove(old)
    return ob

def revolve(name,profile,mat=None,owner=None,n=32,axis='z',center=(0,0,0)):
    vs=[]
    for r,z in profile:
        for j in range(n):
            a=2*math.pi*j/n
            v=Vector((r*math.cos(a),r*math.sin(a),z)) if axis=='z' else Vector((z,r*math.cos(a),r*math.sin(a)))
            vs.append(tuple(v+Vector(center)))
    fs=[]
    for i in range(len(profile)):
        k=(i+1)%len(profile)
        if profile[i][0]==0 and profile[k][0]==0: continue
        for j in range(n): fs.append((i*n+j,i*n+(j+1)%n,k*n+(j+1)%n,k*n+j))
    ob=geometry(name,vs,fs,mat,owner)
    # Weld collapsed polar rings for a truly closed pot floor.
    import bmesh
    bm=bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(ob.data); bm.free()
    return ob
# Continuous vessel wall: rounded lower bowl and eased shoulder, with real inner thickness.
revolve('pot_shell',[(0,.077),(.040,.077),(.058,.079),(.072,.084),(.085,.094),(.096,.108),(.104,.123),(.108,.138),(.109,.148),(.1075,.160),(.103,.173),(.098,.184),(.096,.193),(.096,.204),(.098,.214),(.092,.214),(.090,.204),(.090,.193),(.092,.183),(.097,.171),(.1015,.158),(.103,.147),(.102,.137),(.098,.123),(.090,.108),(.080,.098),(.066,.090),(.052,.085),(0,.084)])
# Rounded folded lip instead of the broad angular blockout crown.
revolve('pot_rolled_rim',[(.098+.0075*math.cos(2*math.pi*j/12),.216+.007*math.sin(2*math.pi*j/12)) for j in range(12)])
revolve('pot_belly_seam',[(.1078,.135),(.110,.1358),(.111,.138),(.1116,.146),(.110,.149),(.1086,.149),(.1083,.145)])
# Gently curved forged legs with chamfered sections, broad flat soles, fitted upper cups.
for label,fx,fy in [('front_left',-.126,-.103),('front_right',.126,-.103),('rear',0,.135)]:
    rr=math.hypot(fx,fy); u=Vector((fx/rr,fy/rr,0)); t=Vector((-u.y,u.x,0))
    stations=[(rr,0,.037,.029),(rr,.004,.037,.029),(rr-.002,.008,.032,.026),(rr-.006,.016,.024,.019),(rr-(rr-.110)*.29,.030,.020,.014),(rr-(rr-.110)*.55,.048,.018,.013),(rr-(rr-.110)*.76,.067,.017,.012),(.111,.087,.017,.012),(.1085,.102,.019,.012),(.109,.114,.021,.012),(.110,.123,.021,.011),(.1085,.128,.016,.009),(.107,.130,.008,.007)]
    vs=[]; fs=[]
    cross=[(.7,1),(-.7,1),(-1,.7),(-1,-.7),(-.7,-1),(.7,-1),(1,-.7),(1,.7)]
    for r,z,w,d in stations:
        c=u*r+Vector((0,0,z))
        vs.extend([tuple(c+t*a*w/2+u*b*d/2) for a,b in cross])
    for i in range(len(stations)-1):
        for j in range(8): fs.append((8*i+j,8*i+(j+1)%8,8*(i+1)+(j+1)%8,8*(i+1)+j))
    fs.extend([tuple(reversed(range(8))),tuple(8*(len(stations)-1)+j for j in range(8))])
    leg=geometry('tripod_leg_'+label,vs,fs)
    leg.modifiers.clear()
    # Small headed fastener through the forged cup, reinforcing the readable bearing joint.
    c=u*.115+Vector((0,0,.118))
    riv=kit.lathe('tripod_cup_rivet_'+label,profile=[(.004,0),(.0045,.001),(.0038,.003),(.002,.004)],segments=10,material=brass,owner=stand)
    riv.rotation_euler=Vector((0,0,1)).rotation_difference(u).to_euler()
    riv.location=root.matrix_world @ c
    # kit parent preserves world transforms, so locate explicitly in world space.
    mw=riv.matrix_world.copy(); mw.translation=root.matrix_world@c; riv.matrix_world=mw
# Turned hinge lugs and domed pin heads on a single straight X axle.
for label,s in [('left',-1),('right',1)]:
    def axprof(p): return [(r,s*x) for r,x in (p if s==1 else list(reversed(p)))]
    revolve('pot_bail_lug_'+label,axprof([(0,.094),(.010,.094),(.014,.100),(.014,.106),(.012,.110),(.008,.113),(0,.113)]),axis='x',center=(0,0,.202),n=12)
    revolve('pot_bail_pin_'+label,axprof([(0,.108),(.0045,.108),(.0045,.124),(.008,.124),(.008,.126),(.0065,.129),(0,.130)]),axis='x',center=(0,0,.202),n=12)
    revolve('bail_hinge_eye_'+label,axprof([(.005,.114),(.0105,.114),(.012,.116),(.012,.121),(.0105,.123),(.005,.123)]),mat=iron,owner=bail,axis='x',center=(0,0,.202),n=16)
# Existing arch, grip and bubbles retained: hierarchy and all original object identities stay stable.
bpy.context.view_layer.update()
for name,p in original.items():
    assert bpy.data.objects.get(name) is not None
    assert (bpy.data.objects[name].parent.name if bpy.data.objects[name].parent else None)==p
# Exercise physical X-axis pivot, including newly fitted hinge eyes; then restore rest pose.
grip=bpy.data.objects['bail_brass_grip']; pivot=bail.matrix_world.translation.copy(); rest=bail.rotation_euler.copy(); gr=grip.matrix_world.translation.copy()
static=[(o,o.matrix_world.copy()) for o in [pot,stand]]
for a in [-math.pi/3, math.pi/3]:
    bail.rotation_euler.x=a; bpy.context.view_layer.update()
    assert (bail.matrix_world@Vector((.12,0,0))-(pivot+Vector((.12,0,0)))).length<1e-6
    assert (grip.matrix_world.translation-gr).length>.02
bail.rotation_euler=rest; bpy.context.view_layer.update()
for o,m in static: assert all(abs(o.matrix_world[i][j]-m[i][j])<1e-7 for i in range(4) for j in range(4))
print('REFINEMENT: all original names/parents retained; bail X axis tested +/-60 degrees and restored; no animation authored.')
finish_asset(material_mode='poly')