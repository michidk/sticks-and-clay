import bpy, math, random
from mathutils import Vector
import assetkit as kit
# Refinement: preserve the supplied source and its articulation coordinates.
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/e8fc5e5a-1b0f-4f6f-85c0-74b673a6ecc0/source.blend')
rng=random.Random(PARAMS.get('seed',1))
root=bpy.data.objects['Paloma_Sedan']
paint=bpy.data.materials['Paloma_BodyPaint']; rubber=bpy.data.materials['Paloma_Rubber']; metal=bpy.data.materials['Paloma_BumperMetal']
for ob in list(bpy.data.objects):
    if ob.type in {'CAMERA','LIGHT'} or ob.name.startswith('Fender_Shoulder_'):
        bpy.data.objects.remove(ob,do_unlink=True)
# Replace the bolted-on semicircular shoulders with integral quarter panels.
# The centre door shell remains 1.76m wide; local fenders cover the fixed 2m track.
axles=(-1.30,1.25)
r=.435
ys={-2.065,-2.005,-1.93,-.63,-.40,0,.40,.59,1.88,2.005,2.065}
for a in axles:
    ys.update([a-r-.025,a+r+.025])
    for i in range(17): ys.add(a+r*math.cos(math.pi*i/16))
ys=sorted(ys)
def width(y):
    d=min(abs(y-a) for a in axles)
    t=max(0.,1.-(d/.77)**2)
    return .88+.218*t*t

def low(y):
    for a in axles:
        d=abs(y-a)
        if d<=r+1e-7:return .38+math.sqrt(max(0.,r*r-d*d))
    return .292
verts=[]
for y in ys:
    x=width(y)
    if abs(y)>2.005:x-=.06*(abs(y)-2.005)/.060
    z=low(y)
    # Cross-section: continuous hood/deck, upper chamfer, upright outer panel,
    # deep arch return and a recessed central underside.
    section=[(-x+.028,.95),(x-.028,.95),(x,.922),(x,z),(.735,z),(.735,.31),(-.735,.31),(-.735,z),(-x,z),(-x,.922)]
    verts.extend((xx,y,zz) for xx,zz in section)
faces=[]
n=10
for j in range(len(ys)-1):
    for k in range(n):faces.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
faces.extend([tuple(reversed(range(n))),tuple((len(ys)-1)*n+k for k in range(n))])
body=bpy.data.objects['Body_ThreeBox_LowerShell']
me=bpy.data.meshes.new('Integrated_QuarterPanels_ArchReturns');me.from_pydata(verts,[],faces);me.update();body.data=me
body.modifiers.clear();me.materials.append(paint)
# Clean normals while retaining deliberately broad flat panels.
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');body.select_set(False)
body['construction']='Integrated fender loft with .435m wheel openings; fixed .38m tire radii retained'
# Four fixed doors: narrow non-opening panel joints, seated on actual side surface.
# Door seams terminate above arches, never crossing the wheels.
def seam(name,side,points):
    points=[(side*(width(y)+.0015),y,z) for y,z in points]
    ob=kit.tube(name,points,radii=.003,segments=4,material=rubber,owner=root)
    return ob
for side,label in [(-1,'L'),(1,'R')]:
    seam('Door_B_Joint_'+label,side,[(-.04,.919),(-.035,.73),(-.025,.48),(.0,.31)])
    seam('Door_Front_Joint_'+label,side,[(-.76,.919),(-.73,.78),(-.70,.59),(-.69,.33)])
    seam('Door_Rear_Joint_'+label,side,[(1.03,.919),(1.06,.835)])
    for y,end in [(-.17,'Front'),(.76,'Rear')]:
        ob=kit.rounded_box('Door_Handle_'+end+'_'+label,size=(.035,.145,.035),location=(side*(width(y)+.012),y,.83),radius=.006,material=metal,owner=root)
# Preserve the approved plain circular wheel faces without ornamental hub detail.
# Keep each wheel exactly one mesh and retain its inherited local axle pivot.
for name in ('wheel_fl','wheel_fr','wheel_rl','wheel_rr'):
    ob=bpy.data.objects[name]
    ob['axle_axis']='X';ob['construction']='Original .76m diameter, .25m width and axle pivot retained'
# All colours are intentionally quiet; this is the requested poly geometry pass.
finish_asset(material_mode='poly')