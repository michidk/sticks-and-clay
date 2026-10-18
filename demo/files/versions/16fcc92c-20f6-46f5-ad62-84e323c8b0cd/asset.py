import bpy, math, random
from mathutils import Vector
import assetkit as kit
# Refinement of the actual preceding export; fixed track and inherited hierarchy.
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/b12b6131-c4ac-4c56-a22e-a076c8ce52ea/source.blend')
rng=random.Random(PARAMS.get('seed',1))
root=bpy.data.objects['Paloma_Sedan']
paint=bpy.data.materials['Paloma_BodyPaint']; rubber=bpy.data.materials['Paloma_Rubber']; metal=bpy.data.materials['Paloma_BumperMetal']
for ob in list(bpy.data.objects):
    if ob.type in {'CAMERA','LIGHT'} or ob.name.startswith(('Fender_Shoulder_','Door_B_Joint_','Door_Front_Joint_','Door_Rear_Joint_','Door_Sill_Joint_','Door_Handle_')):
        bpy.data.objects.remove(ob,do_unlink=True)
# Long rectangular deck: arch flares attach below the straight shoulder.
axles=(-1.30,1.25)
r=.435; outer=.535; bottom=.292
cut=math.sqrt(r*r-(bottom-.38)**2)
outercut=math.sqrt(outer*outer-(bottom-.38)**2)
ys={-2.065,-2.005,-1.93,-.63,-.40,0,.40,.59,1.88,2.005,2.065}
for a in axles:
    ys.update([a-outercut,a+outercut,a-cut,a+cut,a-r,a+r,a-outer,a+outer])
    for i in range(1,16):
        ys.add(a+r*math.cos(math.pi*i/16))
        ys.add(a+outer*math.cos(math.pi*i/16))
ys=sorted(ys)
def low(y,radius):
    d=min(abs(y-a) for a in axles)
    if d<=radius+1e-7:
        points=sorted((radius*math.cos(math.pi*i/16),.38+radius*math.sin(math.pi*i/16)) for i in range(9))
        for (x0,z0),(x1,z1) in zip(points,points[1:]):
            if x0-1e-7<=d<=x1+1e-7:return z0+(z1-z0)*(d-x0)/(x1-x0)
        return .38
    return bottom

def edgewidth(y):
    d=min(abs(y-a) for a in axles)
    t=max(0.,min(1.,(outercut-d)/(outercut-cut)))
    return .88+.218*t

def shellwidth(y):
    return .88-.06*max(0.,(abs(y)-2.005)/.060)

verts=[]
for y in ys:
    x=shellwidth(y); edge=edgewidth(y)-( .88-x)
    z=low(y,r); zo=low(y,outer)
    section=[(-x+.028,.95),(x-.028,.95),(x,.922),(x,zo),(edge,z),(.735,z),(.735,.31),(-.735,.31),(-.735,z),(-edge,z),(-x,zo),(-x,.922)]
    verts.extend((xx,y,zz) for xx,zz in section)
faces=[]; n=12
for j in range(len(ys)-1):
    for k in range(n):faces.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
faces.extend([tuple(reversed(range(n))),tuple((len(ys)-1)*n+k for k in range(n))])
body=bpy.data.objects['Body_ThreeBox_LowerShell']
me=bpy.data.meshes.new('StraightDeck_LocalizedFlaredArchShell'); me.from_pydata(verts,[],faces);me.update();body.data=me
body.modifiers.clear();me.materials.append(paint)
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.00001);bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');body.select_set(False)
# Replace the warped longitudinal flare strips with radially matched conical panels.
# Core stays straight; each closed flare has an inner wheel-well return.
for v in body.data.vertices:
    v.co.x=max(-.88,min(.88,v.co.x))
# The previous flare strips are coplanar on the core; cut the larger outer aperture
# into the core by rebuilding its lower boundary at the outer radius.
# Only outer-arch stations belong to the core; inner-arch stations belong to flares.
ys=sorted({-2.065,-2.005,2.005,2.065}|{a+outer*math.cos(math.pi*i/16) for a in axles for i in range(17)}|{a+s*(outer+.001) for a in axles for s in (-1,1)})
coreverts=[]
for y in ys:
    x=shellwidth(y); z=low(y,outer)
    section=[(-x+.028,.95),(x-.028,.95),(x,.922),(x,z),(.735,z),(.735,.31),(-.735,.31),(-.735,z),(-x,z),(-x,.922)]
    coreverts.extend((xx,y,zz) for xx,zz in section)
corefaces=[];n=10
for j in range(len(ys)-1):
    for k in range(n):corefaces.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
corefaces.extend([tuple(reversed(range(n))),tuple((len(ys)-1)*n+k for k in range(n))])
core=bpy.data.meshes.new('Rectangular_Core_ArchOpenings');core.from_pydata(coreverts,[],corefaces);core.materials.append(paint);core.update();body.data=core
for side,label in [(-1,'L'),(1,'R')]:
    for a,ax in [(-1.30,'Front'),(1.25,'Rear')]:
        contours=[]
        for radius,x in [(outer,.88),(r,1.098),(r,.735),(outer,.735)]:
            pts=[(side*x,a+radius,bottom)]
            pts.extend((side*x,a+radius*math.cos(math.pi*i/16),.38+radius*math.sin(math.pi*i/16)) for i in range(17))
            pts.append((side*x,a-radius,bottom));contours.append(pts)
        vs=[p for c in contours for p in c];fs=[];N=19
        for k in range(4):
            for i in range(N-1):fs.append((k*N+i,k*N+i+1,((k+1)%4)*N+i+1,((k+1)%4)*N+i))
        fs.extend([(0,N,2*N,3*N),(N-1,4*N-1,3*N-1,2*N-1)])
        mesh=bpy.data.meshes.new('RadialArch_'+ax+'_'+label);mesh.from_pydata(vs,[],fs);mesh.materials.append(paint);mesh.update()
        ob=bpy.data.objects.new('Fender_Local_'+ax+'_'+label,mesh);bpy.context.collection.objects.link(ob);ob.parent=root
# Recalculate outward normals for the replaced shell and new closed fenders.
bpy.ops.object.select_all(action='DESELECT')
for ob in bpy.data.objects:
    if ob==body or ob.name.startswith('Fender_Local_'):ob.select_set(True)
bpy.context.view_layer.objects.active=body
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.00001);bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');bpy.ops.object.select_all(action='DESELECT')
# Remove redundant coplanar core strips, retaining all contour and bevel edges.
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.dissolve_limited(angle_limit=.0001);bpy.ops.object.mode_set(mode='OBJECT');body.select_set(False)
body['construction']='Straight 1.76m core and radially matched local fenders; fixed wheel track'
# Fit joints to the actual piecewise-linear mesh, not an analytic curved approximation.
def sample(y,z):
    d=min(abs(y-a) for a in axles); h=max(0.,z-.38)
    angle=math.atan2(h,d); step=math.pi/16
    mid=(math.floor(angle/step)+.5)*step
    fac=math.cos(step/2)/math.cos(angle-mid)
    rho=math.sqrt(d*d+h*h)/fac if h>0 else d
    return .88+.218*max(0.,min(1.,(outer-rho)/(outer-r)))

def seam(name,side,points):
    dense=[]
    for p,q in zip(points,points[1:]):
        for i in range(3):
            t=i/3;y=p[0]*(1-t)+q[0]*t;z=p[1]*(1-t)+q[1]*t
            dense.append((side*(sample(y,z)+.0018),y,z))
    y,z=points[-1];dense.append((side*(sample(y,z)+.0018),y,z))
    return kit.tube(name,dense,radii=.0025,segments=4,material=rubber,owner=root)
for side,label in [(-1,'L'),(1,'R')]:
    seam('Door_B_Joint_'+label,side,[(-.04,.922),(-.04,.305)])
    seam('Door_Front_Joint_'+label,side,[(-.76,.922),(-.73,.69),(-.69,.305)])
    # Rear boundary runs from the C pillar to the actual arch opening.
    seam('Door_Rear_Joint_'+label,side,[(1.03,.922),(1.03,low(1.03,r))])
    seam('Door_Sill_Joint_'+label,side,[(-.69,.305),(.815,.305)])
    for y,end in [(-.17,'Front'),(.76,'Rear')]:
        kit.rounded_box('Door_Handle_'+end+'_'+label,size=(.035,.145,.035),location=(side*(sample(y,.83)+.012),y,.83),radius=.006,material=metal,owner=root)
for name in ('wheel_fl','wheel_fr','wheel_rl','wheel_rr'):
    ob=bpy.data.objects[name]
    ob['axle_axis']='X';ob['construction']='Inherited fixed axle pivot; .76m tire diameter and .25m width unchanged'
finish_asset(material_mode='poly')