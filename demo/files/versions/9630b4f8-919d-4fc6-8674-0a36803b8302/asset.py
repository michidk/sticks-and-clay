import bpy, math, random
from mathutils import Vector
import assetkit as kit
# BLOCKOUT REVISION: saved car retained; replace pod-like flares with integrated quarter panels.
# Fixed contract: 4.30 length, 1.65 roof, 2.25 tire track envelope. Blender front -Y.
# Inferred: quarter shoulders broaden to 2.20 locally, blending to 1.76 central doors.
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/16fcc92c-20f6-46f5-ad62-84e323c8b0cd/source.blend')
rng=random.Random(PARAMS.get('seed',1))
root=bpy.data.objects['Paloma_Sedan']
paint=bpy.data.materials['Paloma_BodyPaint']
for ob in list(bpy.data.objects):
    if ob.type in {'CAMERA','LIGHT'} or ob.name.startswith('Fender_Local_'):
        bpy.data.objects.remove(ob,do_unlink=True)
axles=(-1.30,1.25); radius=.435; bottom=.292
# Broad plateau above each tire and gradual tapered transitions instead of annular projections.
def width(y):
    d=min(abs(y-a) for a in axles)
    if d<=.36: t=1.
    elif d>=.90: t=0.
    else:
        u=(.90-d)/.54; t=u*u*(3-2*u)
    w=.88+.22*t
    # Squared ends keep their original lamp and bumper interfaces.
    end=max(0.,min(1.,(abs(y)-1.78)/.285))
    w=w*(1-end)+(.88-.06*max(0.,(abs(y)-2.005)/.060))*end
    return w
arc=sorted((radius*math.cos(math.pi*i/20),.38+radius*math.sin(math.pi*i/20)) for i in range(21))
def low(y):
    for a in axles:
        d=y-a
        if -radius-1e-8<=d<=radius+1e-8:
            for (x0,z0),(x1,z1) in zip(arc,arc[1:]):
                if x0-1e-8<=d<=x1+1e-8:
                    return z0+(z1-z0)*(d-x0)/(x1-x0)
    return bottom
ys={-2.065,-2.005,-1.93,-1.78,-.4,0,.4,1.78,1.93,2.005,2.065}
for a in axles:
    ys.update(a+d for d,z in arc)
    for d in (-.90,-.78,-.65,-.52,-.36,.36,.52,.65,.78,.90,-radius-.0001,radius+.0001):
        if -2.065<a+d<2.065: ys.add(a+d)
ys=sorted(ys)
verts=[]
for y in ys:
    w=width(y); z=low(y)
    # Closed section with full-depth wheel-well returns; recessed central underbody.
    section=[(-w+.028,.95),(w-.028,.95),(w,.922),(w,z),(.735,z),(.735,.31),(-.735,.31),(-.735,z),(-w,z),(-w,.922)]
    verts.extend((x,y,h) for x,h in section)
n=10; faces=[]
for j in range(len(ys)-1):
    for k in range(n): faces.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
faces.extend([tuple(reversed(range(n))),tuple((len(ys)-1)*n+k for k in range(n))])
body=bpy.data.objects['Body_ThreeBox_LowerShell']
mesh=bpy.data.meshes.new('Integrated_QuarterPanel_ArchShell');mesh.from_pydata(verts,[],faces);mesh.materials.append(paint);mesh.update()
body.data=mesh;body.modifiers.clear()
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.00001);bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.mesh.dissolve_limited(angle_limit=.0001);bpy.ops.object.mode_set(mode='OBJECT');body.select_set(False)
body['construction']='Integrated broad quarter panels; continuous deck with open .435m radius wheel arches; 1.76m middle and 2.20m local shoulders'
# Retain inherited door indications, conforming each vertex to new planar side location.
for ob in bpy.data.objects:
    if ob.type!='MESH':continue
    if ob.name.startswith('Door_') and 'Joint' in ob.name:
        for v in ob.data.vertices:
            side=1 if v.co.x>0 else -1
            d=min(abs(v.co.y-a) for a in axles); h=max(0.,v.co.z-.38)
            angle=math.atan2(h,d); step=math.pi/16
            mid=(math.floor(angle/step)+.5)*step
            fac=math.cos(step/2)/math.cos(angle-mid)
            rho=math.sqrt(d*d+h*h)/fac if h>0 else d
            inherited=.88+.218*max(0.,min(1.,(.535-rho)/.100))
            v.co.x+=side*(width(v.co.y)-inherited)
    if ob.name.startswith('Door_Handle_'):
        side=1 if ob.location.x>0 else -1
        ob.location.x=side*(width(ob.location.y)+.012)
# Matte color-only geometry review; preserve independently recolorable named palette.
for mat in bpy.data.materials:
    if mat.use_nodes:
        for node in mat.node_tree.nodes:
            if node.type=='BSDF_PRINCIPLED':
                node.inputs['Roughness'].default_value=.67
                node.inputs['Metallic'].default_value=0
for name in ('wheel_fl','wheel_fr','wheel_rl','wheel_rr'):
    bpy.data.objects[name]['construction']='Original tire and axle pivot unchanged; integrated body shoulders revised around fixed track'
# Set only for diagnostic previews; zero in final delivery.
DIAGNOSTIC_TILT=0
root.rotation_euler.x=math.radians(DIAGNOSTIC_TILT)
finish_asset(material_mode='poly')