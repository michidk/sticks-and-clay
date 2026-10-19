import bpy, math, random
from mathutils import Vector
import assetkit as kit
rng=random.Random(PARAMS.get('seed',1))
# Hollowmere blockout: metres, front -Y. Rear construction is inferred.
root=kit.root('Alembic_Root')
def assembly(name):
    o=kit.root(name); o.parent=root; return o
boiler=assembly('boiling_assembly')
receiver=assembly('receiver_assembly')
frame=assembly('oak_support_assembly')
plumbing=assembly('brass_plumbing_assembly')
brass=kit.color_material('brass_matte_blockout',(0.56,0.32,0.085,1),roughness=.68)
oak=kit.color_material('honey_oak_matte_blockout',(0.34,0.15,0.047,1),roughness=.8)
glass=kit.color_material('deep_teal_glass_placeholder',(0.025,0.20,0.19,1),roughness=.55)
cork=kit.color_material('stopper_cork_placeholder',(0.48,0.29,0.12,1),roughness=.85)
L=-.073; R=.133

def lathe(name, profile, x, y, material, owner, segments=16):
    obj=kit.lathe(name,profile,segments=segments,material=material,owner=owner)
    obj.location.x=x; obj.location.y=y
    return obj

def band(name, x, y, z, rad, height, material, owner):
    # Annular solid band, not a solid disc through the vessel.
    n=24; inner=rad-.004
    verts=[]
    for rr,zz in [(rad,z-height/2),(rad,z+height/2),(inner,z+height/2),(inner,z-height/2)]:
        verts.extend([(x+rr*math.cos(2*math.pi*i/n),y+rr*math.sin(2*math.pi*i/n),zz) for i in range(n)])
    faces=[]
    for j in range(4):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;c=((j+1)%4)*n+(i+1)%n;d=((j+1)%4)*n+i
            faces.append((a,b,c,d))
    mesh=bpy.data.meshes.new(name+'_mesh');mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.parent=owner;obj.data.materials.append(material)
    kit.bevel(obj,.0007,1)
    return obj

# Primary continuous vessel silhouettes, intentionally matte for geometry review.
lathe('boiling_flask',[(.015,.064),(.035,.069),(.052,.081),(.065,.098),(.072,.120),(.073,.139),(.068,.158),(.055,.177),(.035,.190),(.029,.199),(.029,.210)],L,0,glass,boiler,24)
lathe('flask_mouth_lip',[(.029,.200),(.033,.202),(.033,.208),(.029,.211)],L,0,glass,boiler,24)
lathe('alembic_head',[(.033,.205),(.033,.229),(.027,.239),(.020,.253),(.014,.273),(.010,.293),(.009,.309),(.006,.317),(.001,.320)],L,0,brass,plumbing,20)
band('flask_neck_joint',L,0,.207,.036,.012,brass,plumbing)
band('head_tip_collar',L,0,.307,.0115,.004,brass,plumbing)
lathe('receiving_bottle',[(.023,.024),(.033,.030),(.039,.043),(.040,.056),(.036,.071),(.027,.083),(.017,.090),(.014,.101),(.014,.122)],R,0,glass,receiver,20)
band('receiver_mouth_lip',R,0,.119,.0175,.006,glass,receiver)
band('receiver_neck_fitting',R,0,.126,.020,.007,brass,receiver)
# Stopper pivot is at the mouth; cap inherits its removable vertical motion.
stopper=lathe('receiver_stopper',[(.012,.119),(.012,.129),(.014,.132),(.014,.137)],R,0,cork,receiver,12)
kit.pivot(stopper,(R,0,.123))
cap=lathe('stopper_oak_cap',[(.014,.135),(.017,.138),(.016,.143),(.010,.145)],R,0,oak,receiver,12)
cap.parent=stopper; cap.matrix_parent_inverse=stopper.matrix_world.inverted()
# Swept pipe bends remain one selectable continuous plumbing surface.
pts=[(L+.008,0,.295),(-.042,0,.298),(-.024,0,.295),(-.011,0,.286),(-.003,0,.272),(.003,0,.253),(.010,0,.240),(.025,0,.230),(.068,0,.206),(.103,0,.186),(.112,0,.178),(.116,0,.166),(.116,0,.135),(.119,0,.129)]
pipe=kit.tube('descending_transfer_tube',pts,radii=[.0075,.0075,.0075,.007,.0065,.0065,.0065,.0065,.006,.006,.006,.006,.006,.006],segments=12,material=brass,owner=plumbing)
# Sleeve aligned along the straight diagonal of the transfer path.
def sleeve(name, a, b, rad):
    return kit.tube(name,[a,b],radii=rad,segments=12,material=brass,owner=plumbing)
sleeve('transfer_upper_sleeve',(.014,0,.237),(.024,0,.231),.009)
sleeve('transfer_lower_sleeve',(.093,0,.192),(.102,0,.1865),.008)
# Oak legs: flared feet, narrow shafts, broad top join. All feet touch z=0.
def post(name,x,y,height,width,owner):
    rings=[]
    for z,s in [(0,1.35),(.008,1.35),(.018,.96),(.030,.77),(height-.009,.69),(height,.82)]:
        w=width*s/2
        # clipped square cross-section gives authored chamfered corners
        p=[(-w*.72,-w),(w*.72,-w),(w,-w*.72),(w,w*.72),(w*.72,w),(-w*.72,w),(-w,w*.72),(-w,-w*.72)]
        rings.append([(x+a,y+b,z) for a,b in p])
    return kit.loft(name,rings,material=oak,owner=owner)
for label,x,y in [('left',L-.078,-.014),('right',L+.078,-.014),('rear',L,.103)]:
    post('boiler_support_'+label,x,y,.132,.024,frame)
    kit.rounded_box('boiler_support_collar_'+label,size=(.026,.027,.015),location=(x,y,.113),radius=.002,material=brass,owner=frame)
band('boiler_cradle_band',L,0,.113,.074,.012,brass,frame)
kit.rounded_box('rear_cradle_bridge',size=(.020,.041,.012),location=(L,.085,.113),radius=.0015,material=brass,owner=frame)
# Open triangular base rails, not a solid platform beneath the flask.
for label,a,b in [('left',(L-.078,-.014,.025),(L,.103,.025)),('right',(L+.078,-.014,.025),(L,.103,.025)),('front',(L-.078,-.014,.025),(L+.078,-.014,.025))]:
    d=Vector(b)-Vector(a)
    rail=kit.rounded_box('boiler_base_rail_'+label,size=(.013,.013,d.length),location=(Vector(a)+Vector(b))/2,radius=.001,material=oak,owner=frame)
    rail.rotation_euler=d.to_track_quat('Z','Y').to_euler()
for label,dx,dy in [('front_left',-.031,-.029),('front_right',.031,-.029),('rear_left',-.031,.029),('rear_right',.031,.029)]:
    post('receiver_foot_'+label,R+dx,dy,.036,.014,receiver)
band('receiver_oak_cradle',R,0,.031,.042,.010,oak,receiver)
# Verify stopper translation and attached cap before returning to rest.
bpy.context.view_layer.update()
cap_before=cap.matrix_world.translation.copy()
stopper.location.z+=.025
bpy.context.view_layer.update()
assert abs((cap.matrix_world.translation-cap_before).z-.025)<1e-6
stopper.location.z-=.025
bpy.context.view_layer.update()
assert stopper.parent==receiver and cap.parent==stopper
root['pass']='blockout'
root['construction_notes']='Rear frame inferred; matte glass placeholder; refinement to resolve hollow lips, fitted join interiors and restrained wear.'
root['stopper_motion']='Local +Z removal tested by 25 mm translation and restored; cap follows.'
finish_asset(material_mode='poly')
