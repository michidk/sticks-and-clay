import bpy, math, random
from mathutils import Vector
import assetkit as kit
rng = random.Random(PARAMS.get('seed', 1))
root=kit.root('Paloma_Sedan')

# Matte geometry-review palette, retained under the approved material names.
def mat(name, hexcolor):
    h=hexcolor.lstrip('#'); rgb=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    rgb=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    return kit.color_material(name, color=(*rgb,1), roughness=.72, metallic=0)
paint=mat('Paloma_BodyPaint','55A9B8')
glass=mat('Paloma_Glass','304A52')
rubber=mat('Paloma_Rubber','273334')
metal=mat('Paloma_BumperMetal','B9C2BE')
head=mat('Paloma_Headlight','F2D9A4')
tail=mat('Paloma_Taillight','C64E4B')

def mesh(name, verts, faces, material):
    me=bpy.data.meshes.new(name+'_Mesh'); me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob); ob.parent=root
    ob.data.materials.append(material)
    bpy.context.view_layer.objects.active=ob; ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT'); ob.select_set(False)
    return ob

def box(name,size,loc,material,bev=.015):
    return kit.rounded_box(name,size=size,location=loc,radius=bev,material=material,owner=root)

# Primary shell: a continuous extruded profile with actual open arches.
# Longitudinal s is +front, converted to Blender -Y.
profile=[(-2.075,.30)]
r=.455; cz=.38; sill=.30
angle=math.asin((cz-sill)/r)
for center in (-1.25,1.30):
    for j in range(13):
        a=math.pi+angle-(math.pi+2*angle)*j/12
        profile.append((center+r*math.cos(a),cz+r*math.sin(a)))
profile += [(2.075,.30),(2.075,.79),(1.99,.92),(1.05,.97),(-1.38,.95),(-2.015,.925),(-2.075,.82)]
verts=[]
for sign in (-1,1):
    for s,z in profile:
        w=.88
        if abs(s)>1.99: w-=.07*(abs(s)-1.99)/.085
        verts.append((sign*w,-s,z))
n=len(profile)
faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
for i in range(n):
    j=(i+1)%n; faces.append((i,j,n+j,n+i))
body=mesh('Body_ArchCutShell',verts,faces,paint)
# Selective broad-panel edge softening is deliberately small in the blockout.
kit.bevel(body,width=.009,segments=1)
box('Underbody_Recessed',(1.42,3.94,.15),(0,0,.34),rubber,.025)

# Tapered compact cabin; windows lie on the continuous underlying surfaces.
# bottom front/rear, top front/rear.
frontbase=1.05; rearbase=-1.40; fronttop=.45; reartop=-.79
zbase=.96; ztop=1.65; wb=.858; wt=.718
v=[(-wb,-frontbase,zbase),(wb,-frontbase,zbase),(wb,-rearbase,zbase),(-wb,-rearbase,zbase),
   (-wt,-fronttop,ztop),(wt,-fronttop,ztop),(wt,-reartop,ztop),(-wt,-reartop,ztop)]
cabin=mesh('Cabin_Pillars_Roof',v,[(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],paint)

def side_window(name, sign, points):
    vv=[]
    for s,z in points:
        t=(z-zbase)/(ztop-zbase)
        vv.append((sign*(wb+(wt-wb)*t+.003),-s,z))
    return mesh(name,vv,[tuple(range(len(vv)))],glass)
# Broad B-pillar, margins and C-pillar remain painted structural bands.
for sign, side in [(-1,'L'),(1,'R')]:
    side_window('Glass_FrontDoor_'+side,sign,[(.932,1.015),(-.17,1.015),(-.17,1.585),(.409,1.585)])
    side_window('Glass_RearDoor_'+side,sign,[(-.285,1.015),(-1.255,1.015),(-.762,1.585),(-.285,1.585)])

def screen(name,isfront):
    b,t=(frontbase,fronttop) if isfront else (rearbase,reartop)
    vv=[]
    for u,h in [(-1,.09),(1,.09),(1,.91),(-1,.91)]:
        half=wb+(wt-wb)*h-.064
        s=b+(t-b)*h
        vv.append((u*half,-s+(-.003 if isfront else .003),zbase+(ztop-zbase)*h))
    return mesh(name,vv,[(0,1,2,3)],glass)
screen('Glass_Windshield',True); screen('Glass_RearWindow',False)

# Wheel cross-section: flattened tire sidewalls, chamfered shoulder, plain hubs.
# Each complete tire + face is ONE mesh, local origin on its X axle.
def wheel(name,x,s):
    segments=24
    # One watertight revolved profile: metal face recessed inside the tire envelope.
    half=[(.114,.083),(.102,.105),(.102,.228),(.120,.248),(.125,.278),(.115,.335),(.085,.38)]
    rings=[(-xx,rad) for xx,rad in half]+list(reversed(half))
    vv=[]
    for xx,rad in rings:
        for i in range(segments):
            a=2*math.pi*i/segments
            vv.append((xx,rad*math.sin(a),rad*math.cos(a)))
    ff=[tuple(range(segments-1,-1,-1))]; mids=[1]
    for j in range(len(rings)-1):
        for i in range(segments):
            k=(i+1)%segments
            ff.append((j*segments+i,j*segments+k,(j+1)*segments+k,(j+1)*segments+i))
            mids.append(1 if j<3 or j>=10 else 0)
    ff.append(tuple((len(rings)-1)*segments+i for i in range(segments))); mids.append(1)
    ob=mesh(name,vv,ff,rubber); ob.data.materials.append(metal)
    for p,mi in zip(ob.data.polygons,mids): p.material_index=mi
    ob.location=(x,-s,.38)
    return ob
wheel('wheel_fl',-1,1.30); wheel('wheel_fr',1,1.30)
wheel('wheel_rl',-1,-1.25); wheel('wheel_rr',1,-1.25)

# Primary front and rear equipment: slim clipped bumpers and simple corner lamps.
# Extruded plan profiles preserve squared ends with clipped corner wraps.
def bumper(name,front):
    s=1 if front else -1
    plan=[(-.82,2.15),(.82,2.15),(.885,2.075),(.885,1.94),(.805,2.015),(-.805,2.015),(-.885,1.94),(-.885,2.075)]
    vv=[(x,-y*s,z) for z in (.42,.565) for x,y in plan]; nn=len(plan)
    ff=[tuple(range(nn-1,-1,-1)),tuple(range(nn,nn*2))]
    ff += [(i,(i+1)%nn,(i+1)%nn+nn,i+nn) for i in range(nn)]
    ob=mesh(name,vv,ff,metal); kit.bevel(ob,width=.012,segments=1)
bumper('Bumper_Front',True); bumper('Bumper_Rear',False)
for sign,side in [(-1,'L'),(1,'R')]:
    box('Headlight_'+side,(.42,.073,.22),(sign*.592,-2.06,.747),head,.012)
    box('Taillight_'+side,(.37,.073,.22),(sign*.626,2.069,.755),tail,.01)
box('Grille_Main',( .735,.035,.18),(0,-2.082,.735),rubber,.006)
# Body-colored lower door zones stay quiet during silhouette review.
for ob in list(bpy.data.objects):
    if ob.type=='MESH' and ob.name.startswith('Glass_'):
        kit.open_surface(ob,'Intentional opaque glass overlay seated on the closed cabin shell; no interior reveal.')
finish_asset(material_mode='poly')
