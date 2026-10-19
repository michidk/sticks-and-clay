import bpy, math, random
from mathutils import Vector
import assetkit as kit
rng = random.Random(PARAMS.get('seed',1))
# Hollowmere cauldron: persisted silhouette / blockout pass. Metres, front -Y.
root=kit.root('Cauldron_Root')
copper=kit.color_material('pot_copper_matte',(0.49,0.205,0.074,1),roughness=.72)
edge=kit.color_material('rolled_copper_edge',(0.63,0.30,0.105,1),roughness=.67)
iron=kit.color_material('tripod_forged_iron',(0.065,0.074,0.077,1),roughness=.8)
brass=kit.color_material('bail_grip_aged_brass',(0.48,0.30,0.105,1),roughness=.7)
teal=kit.color_material('brew_deep_teal',(0.022,0.23,0.215,1),roughness=.63)
bubblemat=kit.color_material('brew_bubbles_teal',(0.048,0.35,0.31,1),roughness=.52)
def parent(ob,owner):
    bpy.context.view_layer.update()
    m=ob.matrix_world.copy(); ob.parent=owner; ob.matrix_world=m
    bpy.context.view_layer.update()
    return ob
def empty(name,owner,loc=(0,0,0)):
    ob=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(ob); ob.location=loc
    return parent(ob,owner)
def mesh(name,verts,faces,mat,owner):
    me=bpy.data.meshes.new(name+'_mesh'); me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob); ob.data.materials.append(mat); parent(ob,owner)
    return ob
def revolve(name,profile,mat,owner,n=32):
    vs=[(r*math.cos(2*math.pi*j/n),r*math.sin(2*math.pi*j/n),z) for r,z in profile for j in range(n)]
    fs=[]
    for i in range(len(profile)):
        k=(i+1)%len(profile)
        for j in range(n): fs.append((i*n+j,i*n+(j+1)%n,k*n+(j+1)%n,k*n+j))
    return mesh(name,vs,fs,mat,owner)
def tube(name,pts,r,mat,owner,segments=8):
    return kit.tube(name,points=pts,radii=r,segments=segments,material=mat,owner=owner)
# Primary continuous closed shell: exterior belly flows into neck, then inside wall.
pot=revolve('pot_shell',[(.001,.077),(.045,.077),(.070,.083),(.091,.100),(.105,.126),(.109,.146),(.106,.165),(.096,.185),(.096,.205),(.098,.214),(.092,.214),(.090,.204),(.090,.188),(.100,.164),(.103,.146),(.099,.128),(.085,.105),(.065,.090),(.040,.084),(.001,.084)],copper,root)
rim=revolve('pot_rolled_rim',[(.097,.207),(.103,.209),(.106,.214),(.105,.220),(.101,.223),(.094,.223),(.090,.220),(.090,.214),(.093,.209)],edge,pot)
# Restrained seam as real copper belt, not surface noise.
seam=revolve('pot_belly_seam',[(.108,.135),(.111,.136),(.111,.147),(.109,.149),(.108,.147)],edge,pot)
stand=empty('tripod_assembly',root)
cradle=revolve('tripod_cradle_ring',[(.066,.077),(.080,.077),(.083,.082),(.083,.090),(.077,.093),(.071,.087)],iron,stand)
# Each shaped leg loft includes a broad flat tabletop foot and a narrowing upper crook.
for name,fx,fy in [('front_left',-.126,-.103),('front_right',.126,-.103),('rear',0,.135)]:
    rr=math.hypot(fx,fy); u=Vector((fx/rr,fy/rr,0)); t=Vector((-u.y,u.x,0))
    stations=[(rr,0,.037,.029),(rr,.005,.037,.029),(rr-.004,.014,.025,.021),(.099+(rr-.099)*.60,.035,.018,.014),(.099+(rr-.099)*.27,.066,.017,.013),(.101,.095,.018,.013),(.099,.118,.020,.014),(.096,.128,.017,.012)]
    rings=[]
    for r,z,w,d in stations:
        c=u*r+Vector((0,0,z)); rings.append([tuple(c+t*a*w/2+u*b*d/2) for a,b in [(1,1),(-1,1),(-1,-1),(1,-1)]])
    leg=kit.loft('tripod_leg_'+name,rings=rings,material=iron,owner=stand)
    kit.bevel(leg,width=.0013,segments=1)
    # Load-carrying radial straps connect the leg to the underside cradle.
    tube('tripod_support_'+name,[tuple(u*.099+Vector((0,0,.114))),tuple(u*.093+Vector((0,0,.093))),tuple(u*.077+Vector((0,0,.084)))],.0055,iron,stand,6)
# Bail hinge lugs on the X axis.
for label,sgn in [('left',-1),('right',1)]:
    tube('pot_bail_lug_'+label,[(sgn*.094,0,.202),(sgn*.113,0,.202)],.012,edge,pot,10)
    tube('pot_bail_pin_'+label,[(sgn*.112,0,.202),(sgn*.127,0,.202)],.006,brass,pot,10)
    # Broad readable rivets on the belt.
for j in range(8):
    a=2*math.pi*j/8+math.pi/8; u=Vector((math.cos(a),math.sin(a),0))
    tube('pot_seam_rivet_%02d'%j,[tuple(u*.110+Vector((0,0,.142))),tuple(u*.114+Vector((0,0,.142)))],.0037,brass,pot,8)
bail=empty('bail_assembly',pot,(0,0,.202))
# Continuous rectangular iron arch, with deliberate thickness in depth.
vs=[]
N=24
for i in range(N+1):
    a=math.pi*i/N
    for r,h,y in [(.124,.100,-.0045),(.124,.100,.0045),(.114,.090,.0045),(.114,.090,-.0045)]:
        vs.append((r*math.cos(a),y,.202+h*math.sin(a)))
fs=[]
for i in range(N):
    for j in range(4): fs.append((4*i+j,4*i+(j+1)%4,4*(i+1)+(j+1)%4,4*(i+1)+j))
fs.extend([(3,2,1,0),(4*N,4*N+1,4*N+2,4*N+3)])
arch=mesh('bail_iron_arch',vs,fs,iron,bail)
kit.bevel(arch,width=.0007,segments=1)
grip=kit.lathe('bail_brass_grip',profile=[(.008,-.029),(.011,-.025),(.012,-.014),(.013,0),(.012,.014),(.011,.025),(.008,.029)],segments=10,material=brass)
grip.rotation_euler[1]=math.pi/2; grip.location=(0,0,.297); parent(grip,bail)
for label,x in [('left',-.029),('right',.029)]:
    tube('bail_grip_collar_'+label,[(x-.002,0,.297),(x+.002,0,.297)],.014,brass,bail,10)
# Brew is visibly recessed below the thick lip; bubbles are connected to its surface.
brew=kit.lathe('brew_surface',profile=[(.001,.203),(.0895,.203),(.0895,.205)],segments=32,material=teal,owner=pot)
for i,(x,y,r) in enumerate([(-.032,-.024,.017),(.027,.025,.021),(.044,-.026,.0095),(-.048,.031,.008)]):
    # Hemisphere with a subtly flattened lower ring, not a cloud of floating particles.
    prof=[(.001,.205)]
    for k in range(6):
        a=(math.pi/2)*k/5
        prof.append((max(.0001,r*math.cos(a)),.2045+r*math.sin(a)))
    ob=kit.lathe('brew_bubble_%02d'%i,profile=prof,segments=12,material=bubblemat,owner=brew)
    ob.location.x=x; ob.location.y=y
# Verify physical hinge transform without delivering animation.
bpy.context.view_layer.update()
pivot_world=bail.matrix_world.translation.copy()
rest=bail.rotation_euler.copy(); grip_rest=grip.matrix_world.translation.copy()
for ang in [-math.pi/3,math.pi/3]:
    bail.rotation_euler.x=ang; bpy.context.view_layer.update()
    assert (bail.matrix_world @ Vector((.12,0,0)) - (pivot_world+Vector((.12,0,0)))).length < 1e-6
    assert (grip.matrix_world.translation-grip_rest).length>.02
bail.rotation_euler=rest; bpy.context.view_layer.update()
print('BLOCKOUT: bail tested at +/-60 degrees around local X; restored. Child grip follows. Static pot and tripod.')
print('SEMANTIC_HIERARCHY',[(o.name,o.parent.name if o.parent else None) for o in bpy.context.scene.objects if o.type in {'MESH','EMPTY'}])
finish_asset(material_mode='poly')
