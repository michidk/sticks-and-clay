import bpy, math, random, bmesh
from mathutils import Vector
import assetkit as kit

# Refinement of the supplied baseline, not a reconstruction. Z-up/-Y front.
rng=random.Random(PARAMS.get('seed',1))
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/e5e29f7a-2751-4d98-a672-c94aaf8325b2/source.blend')
root=bpy.data.objects.get('Paloma_Sedan')
if root is None: raise RuntimeError('Expected baseline hierarchy missing')
paint=bpy.data.materials['Paloma_BodyPaint']; glass=bpy.data.materials['Paloma_Glass']
rubber=bpy.data.materials['Paloma_Rubber']; metal=bpy.data.materials['Paloma_BumperMetal']
head=bpy.data.materials['Paloma_Headlight']; tail=bpy.data.materials['Paloma_Taillight']
print('BASELINE',[(o.name,len(o.data.polygons)) for o in bpy.data.objects if o.type=='MESH'])

def mesh(name,vs,fs,mat):
    me=bpy.data.meshes.new(name+'_Mesh'); me.from_pydata(vs,[],fs); me.update()
    ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob); ob.parent=root; me.materials.append(mat)
    bm=bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(me); bm.free()
    return ob

def box(name,size,loc,mat,r=.006):
    return kit.rounded_box(name,size=size,location=loc,radius=r,material=mat,owner=root)

def remove(name):
    ob=bpy.data.objects.get(name)
    if ob: bpy.data.objects.remove(ob,do_unlink=True)

def side_x(z):
    if z<.49: return .845+(z-.29)/.20*.035
    if z>.83: return .88-(z-.83)/.10*.015
    return .88

# Silhouette: retain the exact axle mouths, but crease/taper the broad upright shell.
body=bpy.data.objects['Body_ThreeBox_LowerShell']
bm=bmesh.new(); bm.from_mesh(body.data)
for z in [.49,.83]:
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,z),plane_no=(0,0,1),clear_inner=False,clear_outer=False)
for v in bm.verts:
    v.co.x *= side_x(v.co.z)/.88
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(body.data); bm.free(); body.data.update()

# A folded painted edge gives the four genuine open arches wall thickness.
# The inner radius remains 0.465m, preserving 0.085m radial tire clearance.
for s,side in [(-1,'L'),(1,'R')]:
    for axle,label in [(-1.30,'Front'),(1.25,'Rear')]:
        def path(r):
            return [(axle-r,.29)]+[(axle-r*math.cos(i*math.pi/10),.38+r*math.sin(i*math.pi/10)) for i in range(11)]+[(axle+r,.29)]
        inner=path(.465); outer=path(.502); vs=[]
        for coords,offset in [(inner,.014),(outer,-.001),(outer,-.025),(inner,-.025)]:
            vs.extend([(s*(side_x(z)+offset),y,z) for y,z in coords])
        n=len(inner); fs=[]
        for j in range(4):
            k=(j+1)%4
            for i in range(n-1):fs.append((j*n+i,j*n+i+1,k*n+i+1,k*n+i))
        fs.extend([(0,n,2*n,3*n),(n-1,4*n-1,3*n-1,2*n-1)])
        mesh('Arch_Fold_'+label+'_'+side,vs,fs,paint)

# Secondary interfaces: restrained four-door parting lines and small pull handles.
for s,side in [(-1,'L'),(1,'R')]:
    lines={
        'FrontEdge':[(-.875,.926),(-.81,.82),(-.77,.49),(-.75,.35)],
        'B_Parting':[(.295,.932),(.305,.83),(.325,.49),(.30,.35)],
        'RearEdge':[(1.205,.93),(1.18,.885),(1.04,.861),(.87,.75),(.77,.57),(.755,.35)],
        'Sill':[(-.75,.35),(.30,.35),(.755,.35)]}
    for label,pts in lines.items():
        kit.tube('DoorSeam_'+label+'_'+side,points=[(s*(side_x(z)+.0015),y,z) for y,z in pts],radii=.0032,segments=4,material=rubber,owner=root)
    for label,y in [('Front',.13),('Rear',.92)]:
        box('Handle_Recess_'+label+'_'+side,(.011,.171,.048),(s*.886,y,.803),rubber,.008)
        box('Handle_'+label+'_'+side,(.031,.148,.029),(s*.898,y-.003,.813),metal,.005)
    # Short restrained rocker only in the supported span between arch mouths.
    box('Rocker_Lower_'+side,(.030,1.51,.049),(s*.833,-.025,.312),rubber,.006)

# Hood/trunk parting lines: restrained, following the clipped shell rather than noise.
for s,side in [(-1,'L'),(1,'R')]:
    kit.tube('HoodSeam_'+side,points=[(s*.712,-2.045,.931),(s*.747,-1.96,.931),(s*.747,-.906,.931)],radii=.0025,segments=4,material=rubber,owner=root)
    kit.tube('TrunkSeam_'+side,points=[(s*.747,1.30,.931),(s*.747,1.97,.931),(s*.707,2.039,.931)],radii=.0025,segments=4,material=rubber,owner=root)

# Formed bumpers with clipped corners and short side returns, same +/-2.15 extremities.
for f,label in [(-1,'Front'),(1,'Rear')]:
    remove('Bumper_'+label)
    plan=[(-.76,2.15),(.76,2.15),(.889,2.055),(.902,1.875),(.842,1.875),(.825,2.018),(.738,2.067),(-.738,2.067),(-.825,2.018),(-.842,1.875),(-.902,1.875),(-.889,2.055)]
    vs=[(x,f*y,z) for z in [.421,.519] for x,y in plan]; n=len(plan)
    fs=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    ob=mesh('Bumper_'+label,vs,fs,metal); kit.bevel(ob,width=.009,segments=1)
    # Thin charcoal seating gasket, not an oversized lower guard.
    box('Bumper_Seat_'+label,(1.53,.021,.12),(0,f*2.08,.47),rubber,.005)

# Seat the warm and red lenses in discreet frames; small corner wrap is real geometry.
for s,side in [(-1,'L'),(1,'R')]:
    for label,f,mat,z,w,h in [('Headlight',-1,head,.757,.365,.225),('Taillight',1,tail,.759,.34,.205)]:
        box(label+'_Surround_'+side,(w+.017,.022,h+.017),(s*.648,f*2.078,z),rubber,.009)
        # Short folded end following the body's clipped corner.
        xy=[(s*.788,f*2.066),(s*.868,f*1.986),(s*.878,f*1.996),(s*.798,f*2.077)]
        vs=[(x,y,zz) for zz in [z-h*.43,z+h*.43] for x,y in xy]
        ob=mesh(label+'_Corner_'+side,vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat)
        kit.bevel(ob,width=.004,segments=1)
# Grille's quiet horizontal blades remain subordinate to the broad lamp band.
for i in range(3):
    box('Grille_Blade_%d'%i,(.858,.013,.013),(0,-2.100,.695+i*.053),rubber,.002)

# Correct imported single-sheet windows to shallow seated solids without changing their contour.
for ob in list(bpy.data.objects):
    if ob.type=='MESH' and ob.name.startswith('Glass_'):
        mod=ob.modifiers.new('Seated_Glass_Thickness','SOLIDIFY'); mod.thickness=.006; mod.offset=-1
# Keep separate wheel meshes, original hubs, axle pivots, root and all material names.
for name in ['wheel_fl','wheel_fr','wheel_rl','wheel_rr']:
    ob=bpy.data.objects[name]
    print('PRESERVED_WHEEL',name,tuple(ob.location),tuple(ob.dimensions))
# Consistent single-facet edge treatment: keep small trim crisp, not rounded jewelry.
for ob in bpy.data.objects:
    if ob.type=='MESH':
        for mod in ob.modifiers:
            if mod.type=='BEVEL': mod.segments=1
finish_asset(material_mode='poly')
