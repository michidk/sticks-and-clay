import bpy, math, random
from mathutils import Vector
import assetkit as kit
rng=random.Random(PARAMS.get('seed',1))
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/ba5843b4-a913-489c-9576-3138545cd4ef/source.blend')
root=bpy.data.objects['Alembic_Root']
# Retain the archived asset hierarchy, but not its presentation studio.
keep={root,*root.children_recursive}
for obj in list(bpy.data.objects):
    if obj not in keep: bpy.data.objects.remove(obj,do_unlink=True)
boiler=bpy.data.objects['boiling_assembly']; receiver=bpy.data.objects['receiver_assembly']
frame=bpy.data.objects['oak_support_assembly']; plumbing=bpy.data.objects['brass_plumbing_assembly']
brass=bpy.data.objects['alembic_head'].data.materials[0]
glass=bpy.data.objects['boiling_flask'].data.materials[0]
oak=bpy.data.objects['boiler_support_left'].data.materials[0]
L=-.073; R=.133
print('BASELINE_HIERARCHY',[(o.name,o.parent.name if o.parent else None) for o in keep])
print('BASELINE_ROOT',list(root.location))
# A closed rotational cross-section: outer wall, lip roll, inner wall, thick bottom.
# Mesh replacement retains original selectable identity, local origin and parent.
def revolved_mesh(name, profile, n=24):
    verts=[(r*math.cos(i*2*math.pi/n),r*math.sin(i*2*math.pi/n),z) for r,z in profile for i in range(n)]
    faces=[]
    for j in range(len(profile)):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;c=((j+1)%len(profile))*n+(i+1)%n;d=((j+1)%len(profile))*n+i
            faces.append((a,b,c,d))
    me=bpy.data.meshes.new(name+'_refined_mesh');me.from_pydata(verts,[],faces);me.update();return me

def replace(obj,mesh):
    mats=list(obj.data.materials);obj.data=mesh
    for mat in mats: obj.data.materials.append(mat)
    for mod in list(obj.modifiers):obj.modifiers.remove(mod)
    for p in obj.data.polygons:p.use_smooth=False
    return obj
flask=bpy.data.objects['boiling_flask']
outer=[(.001,.064),(.015,.064),(.034,.069),(.051,.080),(.064,.096),(.071,.114),(.073,.132),(.071,.149),(.064,.166),(.052,.180),(.035,.190),(.030,.197),(.029,.202),(.0305,.204),(.0305,.207),(.028,.209)]
inner=[(.026,.208),(.026,.201),(.027,.196),(.032,.187),(.049,.177),(.061,.163),(.068,.147),(.070,.132),(.068,.115),(.061,.098),(.048,.083),(.032,.073),(.014,.068),(.001,.068)]
replace(flask,revolved_mesh('boiling_flask',outer+inner,24))
replace(bpy.data.objects['flask_mouth_lip'],revolved_mesh('flask_mouth_lip',[(.029,.199),(.032,.201),(.033,.203),(.033,.207),(.031,.210),(.027,.210),(.026,.208),(.026,.202)],24))
bottle=bpy.data.objects['receiving_bottle']
outer=[(.001,.024),(.022,.024),(.031,.029),(.037,.039),(.040,.052),(.039,.062),(.035,.073),(.027,.083),(.018,.090),(.015,.097),(.014,.108),(.014,.118),(.0155,.121),(.0155,.123)]
inner=[(.0115,.123),(.011,.119),(.011,.108),(.012,.097),(.015,.088),(.024,.080),(.032,.070),(.036,.060),(.037,.051),(.034,.040),(.028,.032),(.020,.028),(.001,.028)]
replace(bottle,revolved_mesh('receiving_bottle',outer+inner,20))
# Hollow fitted head shell with a real lower opening and rolled seat.
replace(bpy.data.objects['alembic_head'],revolved_mesh('alembic_head',[(.032,.205),(.033,.209),(.033,.228),(.031,.233),(.026,.241),(.020,.253),(.015,.267),(.0115,.283),(.010,.298),(.009,.309),(.006,.317),(.001,.320),(.001,.317),(.004,.314),(.006,.307),(.007,.298),(.0085,.283),(.012,.267),(.017,.252),(.023,.240),(.028,.231),(.030,.226),(.030,.208)],24))
# Raised and recessed lands clarify sealing lips, without ornamental rings.
replace(bpy.data.objects['flask_neck_joint'],revolved_mesh('flask_neck_joint',[(.033,.201),(.0355,.202),(.036,.204),(.036,.207),(.035,.208),(.0355,.210),(.0355,.212),(.033,.214),(.031,.213),(.031,.202)],24))
bpy.data.objects['flask_neck_joint'].location=(L,0,0)
replace(bpy.data.objects['receiver_neck_fitting'],revolved_mesh('receiver_neck_fitting',[(.016,.122),(.0195,.122),(.020,.124),(.020,.128),(.0185,.130),(.015,.130),(.015,.124)],20))
bpy.data.objects['receiver_neck_fitting'].location=(R,0,0)
# Refine the continuous pipe with tangent-controlled cubic bends, retaining diagonal span.
def bez(a,b,c,d,n):
    return [tuple((1-t)**3*Vector(a)+3*(1-t)**2*t*Vector(b)+3*(1-t)*t*t*Vector(c)+t**3*Vector(d)) for t in [i/n for i in range(n+1)]]
pts=bez((-.066,0,.295),(-.024,0,.306),(-.010,0,.289),(-.004,0,.269),10)
pts+=bez((-.004,0,.269),(.002,0,.247),(.005,0,.243),(.024,0,.231),8)[1:]
pts+=[(.098,0,.189)]
pts+=bez((.098,0,.189),(.116,0,.179),(.116,0,.174),(.116,0,.159),7)[1:]
pts+=[(.116,0,.137)]
pts+=bez((.116,0,.137),(.116,0,.130),(.117,0,.126),(.121,0,.126),5)[1:]
# Planar parallel-frame sweep avoids axis switching as the tube becomes vertical.
verts=[];faces=[];n=12
for j,p in enumerate(pts):
    tangent=(Vector(pts[min(j+1,len(pts)-1)])-Vector(pts[max(0,j-1)])).normalized()
    u=Vector((0,1,0));v=tangent.cross(u).normalized()
    for i in range(n):
        a=2*math.pi*i/n;verts.append(tuple(Vector(p)+.0057*(math.cos(a)*u+math.sin(a)*v)))
for j in range(len(pts)-1):
    for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
faces.extend([tuple(reversed(range(n))),tuple((len(pts)-1)*n+i for i in range(n))])
me=bpy.data.meshes.new('descending_transfer_refined_sweep');me.from_pydata(verts,[],faces);me.update()
replace(bpy.data.objects['descending_transfer_tube'],me)
# Sleeves gain eased shoulders and sit along the established descending diagonal.
def fitted_sleeve(name,a,b,r):
    o=bpy.data.objects.get(name)
    d=Vector(b)-Vector(a); h=d.length
    profile=[(r*.76,0),(r*.94,.001),(r,.002),(r,h-.002),(r*.94,h-.001),(r*.76,h),(r*.65,h),(r*.65,0)]
    me=revolved_mesh(name,profile,12)
    if o: replace(o,me)
    else:
        o=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(o);o.data.materials.append(brass);o.parent=plumbing
    o.location=a;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();return o
fitted_sleeve('transfer_upper_sleeve',(.014,0,.237),(.025,0,.2304),.0086)
fitted_sleeve('transfer_lower_sleeve',(.090,0,.19354),(.100,0,.18786),.0078)
fitted_sleeve('receiver_inlet_gland',(.116,0,.129),(.116,0,.138),.0077)
# Restrained join hardware. Buttons are chamfered hex heads, not decorative studs.
def bolt(name,pos,direction,r=.0035,owner=frame):
    o=kit.lathe(name,[(r*.78,0),(r,.0006),(r,.002),(r*.78,.0026)],segments=6,material=brass,owner=owner)
    o.location=pos;o.rotation_euler=Vector(direction).to_track_quat('Z','Y').to_euler();return o
for label,x,y in [('left',L-.078,-.014),('right',L+.078,-.014),('rear',L,.103)]:
    # Matching shallow brass shoe bands reinforce flared oak/shaft transitions.
    kit.rounded_box('boiler_foot_ferrule_'+label,size=(.021,.022,.004),location=(x,y,.024),radius=.001,material=brass,owner=frame)
    direction=(0,1,0) if label=='rear' else (0,-1,0)
    bolt('boiler_collar_bolt_'+label,(x,y+direction[1]*.0137,.113),direction)
for label,dx,dy in [('front_left',-.031,-.029),('front_right',.031,-.029),('rear_left',-.031,.029),('rear_right',.031,.029)]:
    direction=(0,-1,0) if dy<0 else (0,1,0)
    kit.rounded_box('receiver_foot_bracket_'+label,size=(.013,.013,.009),location=(R+dx,dy,.032),radius=.001,material=brass,owner=receiver)
    bolt('receiver_bracket_bolt_'+label,(R+dx,dy+direction[1]*.0068,.032),direction,.0025,receiver)
for label,sign in [('left',-1),('right',1)]:
    bolt('head_seat_pin_'+label,(L+sign*.035,0,.207),(sign,0,0),.003,plumbing)
# The imported root is already ground-centered. Box helper placement is world-space;
# explicitly seat new hardware in the same local construction space as existing legs.
from mathutils import Matrix
for label,x,y in [('left',L-.078,-.014),('right',L+.078,-.014),('rear',L,.103)]:
    o=bpy.data.objects['boiler_foot_ferrule_'+label]
    o.matrix_parent_inverse=Matrix.Identity(4);o.location=(x,y,.024)
for label,dx,dy in [('front_left',-.031,-.029),('front_right',.031,-.029),('rear_left',-.031,.029),('rear_right',.031,.029)]:
    o=bpy.data.objects['receiver_foot_bracket_'+label]
    o.matrix_parent_inverse=Matrix.Identity(4);o.location=(R+dx,dy,.032)
# Preserve and actually test local vertical removal and cap attachment.
stopper=bpy.data.objects['receiver_stopper'];cap=bpy.data.objects['stopper_oak_cap']
bpy.context.view_layer.update();rest=stopper.location.copy();before=cap.matrix_world.copy()
stopper.location.z+=.025;bpy.context.view_layer.update()
assert abs((cap.matrix_world.translation-before.translation).z-.025)<1e-6
stopper.location=rest;bpy.context.view_layer.update()
assert stopper.parent==receiver and cap.parent==stopper
assert abs(stopper.matrix_world.to_3x3().col[2].normalized().dot(Vector((0,0,1)))-1)<1e-6
print('STOPPER_PIVOT',list(stopper.location),'25mm local +Z removal verified; cap follows')
for o in root.children_recursive:
    if o.type=='MESH':
        assert o.data.materials, o.name
root['pass']='refinement_geometry'
root['construction_notes']='Preserved baseline names and vessel proportions. Hollow glass walls 3-4mm, hollow head, rolled lips, shaped fitting lands, tangent-controlled pipe bends, structural fasteners and foot ferrules. Rear tripod inferred from baseline. Temporary opaque matte palette; no textures in geometry pass.'
root['stopper_motion']='Local +Z removal tested over 25mm; cap follows; restored.'
print('REFINED_HIERARCHY',[(o.name,o.parent.name) for o in root.children_recursive])
finish_asset(material_mode='poly')