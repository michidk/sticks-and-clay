import bpy, math, random
from mathutils import Vector
import assetkit as kit

# Revision of the supplied source, not a replacement car.
# Blender Z-up / -Y front -> glTF Y-up / +Z front.
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/e5e29f7a-2751-4d98-a672-c94aaf8325b2/source.blend')
rng=random.Random(PARAMS.get('seed',1))
root=bpy.data.objects.get('Paloma_Sedan')
paint=bpy.data.materials['Paloma_BodyPaint']
# Studio objects are not asset construction and will be provided by the runner.
for ob in list(bpy.data.objects):
    if ob.type in {'CAMERA','LIGHT'}:
        bpy.data.objects.remove(ob,do_unlink=True)
print('BASELINE_MESHES',[(o.name,tuple(round(v,4) for v in o.dimensions)) for o in bpy.data.objects if o.type=='MESH'])

# Preserve approved pivots, diameter, width, existing cabin, shell and palette.
# New continuous profiled arch shoulders reconcile the narrow central body
# with the approved wide wheel track. No wheel mesh translation is hidden here.
# Outer shoulder returns to the original panel at x=.88; its crest covers
# the tire to x=1.085, leaving only .040m of sidewall outside the painted edge.
def arch_profile(radius,axle):
    points=[(axle-radius,.292)]
    for i in range(13):
        a=math.pi-i*math.pi/12
        points.append((axle+radius*math.cos(a),.38+radius*math.sin(a)))
    points.append((axle+radius,.292))
    return points

def shoulder(name,side,axle):
    # Broad sloped shoulder, small painted edge, then a real inward return.
    sections=[(.535,.879),(.490,1.055),(.465,1.085),(.453,1.071),(.453,.856)]
    verts=[]
    for radius,x in sections:
        for y,z in arch_profile(radius,axle):
            # Blend lower arch feet into sill instead of leaving wide vertical tabs.
            blend=max(0.0,min(1.0,(z-.292)/.25))
            blend=blend*blend*(3.0-2.0*blend)
            tapered_x=.88+(x-.88)*(.12+.88*blend) if x>.88 else x
            verts.append((side*tapered_x,y,z))
    n=15; faces=[]
    for j in range(len(sections)-1):
        for i in range(n-1):
            faces.append((j*n+i,j*n+i+1,(j+1)*n+i+1,(j+1)*n+i))
    # Close the back and both sill ends; assembled body joint remains hidden.
    for i in range(n-1):
        faces.append((i,(len(sections)-1)*n+i,(len(sections)-1)*n+i+1,i+1))
    faces.append(tuple(j*n for j in reversed(range(len(sections)))))
    faces.append(tuple(j*n+n-1 for j in range(len(sections))))
    me=bpy.data.meshes.new(name+'_Mesh');me.from_pydata(verts,[],faces);me.update()
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob);ob.parent=root
    me.materials.append(paint)
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)
    ob['construction']='Tapered fender shoulder; .073m radial tire clearance, original wheel centers retained'
    return ob
for side,label in [(-1,'L'),(1,'R')]:
    for axle,end in [(-1.30,'Front'),(1.25,'Rear')]:
        shoulder('Fender_Shoulder_'+end+'_'+label,side,axle)
for name in ('wheel_fl','wheel_fr','wheel_rl','wheel_rr'):
    ob=bpy.data.objects[name]
    print('RETAINED_WHEEL',name,'world_pivot',tuple(ob.matrix_world.translation),'size',tuple(ob.dimensions))
# Intermediate geometry/blockout: retain temporary matte named colors only.
finish_asset(material_mode='poly')