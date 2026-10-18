import bpy, math
from mathutils import Vector
import assetkit as kit

# PALOMA / persisted blockout. Blender -Y forward, Z up converts to glTF +Z forward, Y up.
# Specified dimensions are exact; cabin stations and bumper/lamp proportions are inferred.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
root = kit.root('Paloma_Sedan')
root['pass'] = 'blockout'
root['specified_ground_gap_m'] = 0.10
root['construction_notes'] = 'Inferred cabin stations; secondary seams, mirrors, arch trim and lens detailing deferred.'

def srgb(h):
    vals=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in vals)+(1,)
def mat(n,h): return kit.color_material(n,color=srgb(h),roughness=.72,metallic=0)
paint=mat('Paloma_BodyPaint','55A9B8')
glass=mat('Paloma_Glass','304A52')
rubber=mat('Paloma_Rubber','273334')
metal=mat('Paloma_BumperMetal','B9C2BE')
head=mat('Paloma_Headlight','F2D9A4')
tail=mat('Paloma_Taillight','C64E4B')

def mesh(n,verts,faces,material):
    me=bpy.data.meshes.new(n+'_Mesh'); me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(n,me); bpy.context.collection.objects.link(ob); ob.parent=root
    ob.data.materials.append(material)
    return ob

def box(n,size,loc,material,r=.015):
    return kit.rounded_box(n,size=size,location=loc,radius=r,material=material,owner=root)

def prism(n,outline,z0,z1,material):
    vs=[(x,y,z) for z in (z0,z1) for x,y in outline]; N=len(outline)
    fs=[tuple(reversed(range(N))),tuple(range(N,2*N))]
    fs += [(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)]
    return mesh(n,vs,fs,material)

# Primary shell: squared ends, clipped corners, genuinely removed arch volumes.
outline=[(-.80,-2.07),(.80,-2.07),(.88,-1.98),(.88,1.98),(.80,2.07),(-.80,2.07),(-.88,1.98),(-.88,-1.98)]
body=prism('Body_ArchCutShell',outline,.34,.96,paint)
for y,label in [(-1.30,'Front'),(1.25,'Rear')]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=.445,depth=2.1,location=(0,y,.48),rotation=(0,math.pi/2,0))
    cutter=bpy.context.object; cutter.name='TEMP_'+label+'Arch'
    bpy.context.view_layer.objects.active=body
    mod=body.modifiers.new(label+'_OpenArches','BOOLEAN'); mod.operation='DIFFERENCE'; mod.solver='EXACT'; mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
kit.bevel(body,width=.014,segments=1)
# Underbody is kept narrow and cannot fill the arch voids seen from the sides.
box('Underbody_Recessed',(.95,3.72,.13),(0,0,.355),rubber,.025)

# Continuous tapered cabin volume, not intersecting placeholder boxes.
verts=[(-.84,-.73,.955),(.84,-.73,.955),(.84,1.35,.955),(-.84,1.35,.955),
       (-.72,-.20,1.65),(.72,-.20,1.65),(.72,.85,1.65),(-.72,.85,1.65)]
cabin=mesh('Cabin_PaintedPillars_Roof',verts,[(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],paint)
kit.bevel(cabin,width=.012,segments=1)

# Opaque window patches follow the actual cabin planes. Quiet painted gaps form A/B/C pillars.
def patch(n,vs):
    ob=mesh(n,vs,[(0,1,2,3)],glass)
    mod=ob.modifiers.new('OpaqueGlassThickness','SOLIDIFY'); mod.thickness=.005
    return ob
for s,side in [(-1,'L'),(1,'R')]:
    def p(y,z): return (s*(.84-(z-.955)*.12/.695+.004),y,z)
    patch('Glass_FrontDoor_'+side,[p(-.625,1.015),p(.29,1.015),p(.29,1.57),p(-.19,1.57)])
    patch('Glass_RearDoor_'+side,[p(.395,1.015),p(1.205,1.015),p(.815,1.57),p(.395,1.57)])

def frontp(x,z):return (x,-.73+(z-.955)*.53/.695-.005,z)
patch('Glass_Windshield',[frontp(-.755,1.01),frontp(.755,1.01),frontp(.665,1.57),frontp(-.665,1.57)])
def rearp(x,z):return (x,1.35-(z-.955)*.50/.695+.005,z)
patch('Glass_RearWindow',[rearp(.755,1.01),rearp(-.755,1.01),rearp(-.665,1.57),rearp(.665,1.57)])

# Four mesh wheels, single joined material-indexed geometry each, with local axle origins.
def wheel(n,x,y):
    N=24
    rings=[(-.125,.0),(-.125,.235),(-.125,.30),(-.105,.355),(-.07,.38),(.07,.38),(.105,.355),(.125,.30),(.125,.235),(.125,.0)]
    vs=[(a,r*math.sin(2*math.pi*i/N),r*math.cos(2*math.pi*i/N)) for a,r in rings for i in range(N)]
    fs=[]; ids=[]
    for j in range(len(rings)-1):
        for i in range(N):
            fs.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
            ids.append(1 if j in (0,8) else 0)
    ob=mesh(n,vs,fs,rubber); ob.data.materials.append(metal)
    for poly,idx in zip(ob.data.polygons,ids):poly.material_index=idx
    ob.location=(x,y,.48)
    ob['axle_axis']='X'; ob['tire_diameter_m']=.76; ob['axial_width_m']=.25
    return ob
for n,x,y in [('wheel_fl',-1,-1.30),('wheel_fr',1,-1.30),('wheel_rl',-1,1.25),('wheel_rr',1,1.25)]: wheel(n,x,y)

# Major recognition cues, deliberately restrained for blockout review.
for y,label in [(-2.07,'Front'),(2.07,'Rear')]:
    bumper=prism('Bumper_'+label,[(-.84,y-.08),(.84,y-.08),(.90,y-.025),(.90,y+.025),(.84,y+.08),(-.84,y+.08),(-.90,y+.025),(-.90,y-.025)],.43,.57,metal)
    kit.bevel(bumper,width=.012,segments=1)
for s,side in [(-1,'L'),(1,'R')]:
    box('Headlight_'+side,(.45,.045,.215),(s*.575,-2.075,.785),head,.012)
    box('Taillight_'+side,(.40,.045,.18),(s*.60,2.075,.79),tail,.012)
    for y,door in [(.15,'Front'),(.99,'Rear')]:
        box('Handle_'+door+'_'+side,(.026,.145,.045),(s*.89,y,.879),metal,.006)
box('Grille_Recess',(.61,.026,.16),(0,-2.078,.774),rubber,.007)

# No texture dependency or optional game interfaces in this visual-only geometry pass.
# Resolve actual mesh closure before handoff; weld radial fan centers and apply glass thickness.
import bmesh
for ob in list(root.children):
    if ob.type != 'MESH': continue
    if ob.name.startswith('wheel_'):
        bm=bmesh.new(); bm.from_mesh(ob.data)
        bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(ob.data); bm.free(); ob.data.update()
    if ob.name.startswith('Glass_'):
        bpy.context.view_layer.objects.active=ob
        bpy.ops.object.modifier_apply(modifier='OpaqueGlassThickness')
root['export_limitation']='Fixed runner grounds lowest tire points, translating root down 0.10m. Local authored wheel pivots remain specified; global ride height needs pipeline support.'
finish_asset(material_mode='poly')
