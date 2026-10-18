import bpy, math, random
from mathutils import Vector
import assetkit as kit
# Refinement: preserve saved hierarchy, cabin, wheels and interfaces.
# Fixed: 4.30 length / 1.65 height / 1.76 main shell / 2.25 tire envelope.
# Inferred: shaped local arch returns reach x=1.10 only below the beltline.
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/9630b4f8-919d-4fc6-8674-0a36803b8302/source.blend')
rng=random.Random(PARAMS.get('seed',1))
root=bpy.data.objects['Paloma_Sedan']
paint=bpy.data.materials['Paloma_BodyPaint']
for ob in list(bpy.data.objects):
    if ob.type in {'CAMERA','LIGHT'} or ob.name.startswith('Fender_Local_'):
        bpy.data.objects.remove(ob,do_unlink=True)
print('BASELINE_PARTS',[(ob.name,tuple(round(v,4) for v in ob.location),len(ob.data.vertices)) for ob in bpy.data.objects if ob.type=='MESH'])
axles=(-1.30,1.25); radius=.435; bottom=.292
# Straight rectangular upper shell, clipped end corners. No axle-based deck widening.
def width(y):
    return .88-.06*max(0.,min(1.,(abs(y)-2.005)/.060))
arc=sorted((radius*math.cos(math.pi*i/16),.38+radius*math.sin(math.pi*i/16)) for i in range(17))
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
    for d in (-.60,-.53,-.48,.48,.53,.60,-radius-.0001,radius+.0001):
        if -2.065<a+d<2.065: ys.add(a+d)
ys=sorted(ys)
# Closed structural shell with side-profile cutouts and full depth reveals.
verts=[]
for y in ys:
    w=width(y); z=low(y)
    section=[(-w+.028,.95),(w-.028,.95),(w,.922),(w,z),(.735,z),(.735,.31),(-.735,.31),(-.735,z),(-w,z),(-w,.922)]
    verts.extend((x,y,h) for x,h in section)
n=10; faces=[]
for j in range(len(ys)-1):
    for k in range(n): faces.append((j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k))
faces.extend([tuple(reversed(range(n))),tuple((len(ys)-1)*n+k for k in range(n))])
body=bpy.data.objects['Body_ThreeBox_LowerShell']
mesh=bpy.data.meshes.new('Straight_Beltline_ArchShell');mesh.from_pydata(verts,[],faces);mesh.materials.append(paint);mesh.update()
body.data=mesh;body.modifiers.clear()
def clean(ob):
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.00001);bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.mesh.dissolve_limited(angle_limit=.0001);bpy.ops.object.mode_set(mode='OBJECT');ob.select_set(False)
clean(body)
body['construction']='Straight 1.76m main shell with four open arch cutouts; local lower arch returns, not swollen deck panels'
# Each fender is a tapered, thick structural arch. Upper attachment fades into
# the side below the unbroken beltline; front/back feet stop on the painted sill.
for side in (-1,1):
    for axle,label in zip(axles,('front','rear')):
        path=[(-radius,bottom)]+arc+[(radius,bottom)]
        vv=[]
        # Four matching contours: outer attachment, outer lip, inner lip, inner attachment.
        for layer in range(4):
            for d,z in path:
                isfoot=z==bottom
                if isfoot:
                    od=math.copysign(.57,d); oz=bottom
                else:
                    theta=math.atan2(z-.38,d)
                    od=.57*math.cos(theta);oz=.38+.51*math.sin(theta)
                if layer==0: x=.878; yy=axle+od; zz=oz
                elif layer==1: x=1.10;yy=axle+d*1.045;zz=z+(.018 if not isfoot else 0)
                elif layer==2: x=1.10;yy=axle+d;zz=z
                else: x=.865;yy=axle+d;zz=z
                vv.append((side*x,yy,zz))
        m=len(path); ff=[]
        for l in range(4):
            for j in range(m-1):ff.append((l*m+j,l*m+j+1,((l+1)%4)*m+j+1,((l+1)%4)*m+j))
        ff.extend([(0,m,2*m,3*m),(m-1,4*m-1,3*m-1,2*m-1)])
        me=bpy.data.meshes.new('Tapered_Arch_Return');me.from_pydata(vv,[],ff);me.materials.append(paint);me.update()
        ob=bpy.data.objects.new('Fender_Arch_'+label+('_L' if side<0 else '_R'),me);bpy.context.collection.objects.link(ob);ob.parent=root
        clean(ob)
# Replace distorted inherited seam solids with deliberate narrow surface ribbons.
paths={'B':[(.05,.93),(.05,.32)],
       'Front':[(-.86,.93),(-.76,.61),(-.72,.32)],
       'Rear':[(.83,.93),(.80,.75),(.64,.53),(.64,.32)],
       'Sill':[(-.72,.312),(.64,.312)]}
for ob in bpy.data.objects:
    if ob.type!='MESH':continue
    if ob.name.startswith('Door_') and 'Joint' in ob.name:
        side=-1 if ob.name.endswith('_L') else 1
        key=ob.name.split('_')[1]; path=paths[key]; sv=[];sf=[]
        for j,(y,z) in enumerate(path):
            a=Vector(path[max(0,j-1)]);b=Vector(path[min(len(path)-1,j+1)])
            t=(b-a).normalized();dy=-t.y*.002;dz=t.x*.002
            sv.extend([(side*.882,y-dy,z-dz),(side*.882,y+dy,z+dz)])
        for j in range(len(path)-1):sf.append((2*j,2*j+1,2*j+3,2*j+2))
        me=bpy.data.meshes.new(ob.name+'_Ribbon');me.from_pydata(sv,[],sf);me.materials.append(bpy.data.materials['Paloma_Rubber']);me.update();ob.data=me;ob.modifiers.clear()
        kit.open_surface(ob,'Narrow opaque door seam marking seated on closed painted body')
    if ob.name.startswith('Door_Handle_'):
        side=1 if ob.location.x>0 else -1
        ob.location.x=side*.892
# Matte geometry review, no image textures.
for mat in bpy.data.materials:
    if mat.use_nodes:
        for node in mat.node_tree.nodes:
            if node.type=='BSDF_PRINCIPLED':
                node.inputs['Roughness'].default_value=.67
                node.inputs['Metallic'].default_value=0
for name in ('wheel_fl','wheel_fr','wheel_rl','wheel_rr'):
    bpy.data.objects[name]['construction']='Saved tire dimensions and axle pivot preserved'
# Normal ground-centered delivery orientation: Blender Z-up, front -Y.
root.rotation_mode='XYZ'
root.rotation_euler=(0,0,0)
finish_asset(material_mode='poly')