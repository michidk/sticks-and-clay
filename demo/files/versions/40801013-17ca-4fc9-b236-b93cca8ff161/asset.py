import bpy, math, random, json, os, struct
from mathutils import Vector, Matrix
import assetkit as kit

# Persisted refinement: load original, preserve semantic objects and pivots.
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/c6564cbd-4059-481e-9184-1b9414006677/source.blend')
rng=random.Random(PARAMS.get('seed',1))
root=bpy.data.objects['Mortar_Root']
body=bpy.data.objects['mortar_body']
band=bpy.data.objects['mortar_repair_band']
pestle=bpy.data.objects['Pestle']
tool=bpy.data.objects['pestle_stone']
collar=bpy.data.objects['pestle_brass_collar']
print('BASELINE_HIERARCHY',[(o.name,o.parent.name if o.parent else None,tuple(o.location),tuple(o.scale)) for o in (root,body,band,pestle,tool,collar)])
stone=body.data.materials[0]
brass=band.data.materials[0]
# Temporary, intentionally quiet matte geometry-review materials.
for mat in (stone,brass):
    if mat.use_nodes:
        bs=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
        if bs: bs.inputs['Roughness'].default_value=.78 if mat==brass else .86

def replace_mesh(obj,verts,faces,mats):
    mesh=bpy.data.meshes.new(obj.name+'_refined_mesh')
    mesh.from_pydata(verts,[],faces); mesh.update()
    obj.data=mesh
    for m in mats: mesh.materials.append(m)
    for m in list(obj.modifiers): obj.modifiers.remove(m)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); bpy.context.view_layer.objects.active=obj
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=.000001)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT'); obj.select_set(False)
    return mesh

# One watertight surface: flat sole -> broad foot -> rounded bowl -> worn
# lip -> concave grinding floor. Dimensions are inferred within brief targets.
profile=[(0,0),(.060,0),(.068,.0025),(.071,.006),(.0715,.013),
 (.070,.019),(.066,.024),(.0625,.027),(.065,.031),(.073,.040),
 (.0815,.052),(.089,.067),(.095,.084),(.099,.103),(.1005,.119),
 (.100,.131),(.0985,.137),(.094,.140),(.086,.140),(.082,.138),
 (.0795,.133),(.078,.122),(.074,.104),(.067,.085),(.056,.067),
 (.042,.054),(.027,.048),(.013,.046),(0,.0455)]
N=40
verts=[]
# Sparse wear in rim, not ornamental crack networks.
notches=[(math.radians(-102),.0018,.065),(math.radians(22),.0012,.08),(math.radians(155),.0015,.07)]
def angle_dist(a,b): return (a-b+math.pi)%(2*math.pi)-math.pi
for j,(r,z) in enumerate(profile):
    for i in range(N):
        a=2*math.pi*i/N
        phase=.006*math.sin(3*a+j*.83) if 8<=j<=16 else 0
        a+=phase
        shape=.00065*math.sin(3*a+.5)+.00035*math.cos(7*a)
        rr=r+(shape if r else 0)
        zz=z
        if 9<=j<=15:
            rr+=.00035*math.sin(5*a+j*.8)
            zz+=.00055*math.sin(4*a+j*.9)
        if 15<=j<=21:
            weight={15:.35,16:.8,17:1,18:1,19:1,20:.7,21:.2}[j]
            wear=sum(d*math.exp(-(angle_dist(a,ang)/width)**2) for ang,d,width in notches)
            zz+=weight*(.0012*math.sin(3*a+.5)+.00055*math.cos(5*a)-wear)
            if 16<=j<=19: rr+=.00045*math.sin(11*a+.7)
        if j>=23 and r:
            zz+=.0002*math.cos(3*a)*min(1,r/.04)
        verts.append((rr*math.cos(a),rr*math.sin(a),zz))
faces=[]
for j in range(len(profile)-1):
    for i in range(N):
        k=(i+1)%N
        q=(j*N+i,j*N+k,(j+1)*N+k,(j+1)*N+i)
        # Irregular broad hewn facets on exterior; keep the grinding surface quiet.
        if 8<=j<=16 and (i+2*j)%5 in (0,1):
            if (i+j)%2: faces.extend([(q[0],q[1],q[3]),(q[1],q[2],q[3])])
            else: faces.extend([(q[0],q[1],q[2]),(q[0],q[2],q[3])])
        else: faces.append(q)
replace_mesh(body,verts,faces,[stone])

# Conforming repair strap: actual closed thickness, softened edges and
# overlapping end shoes with rivets, all attached to the stationary root.
def outer_radius(z,a):
    outer=profile[8:18]
    for (r0,z0),(r1,z1) in zip(outer[:-1],outer[1:]):
        if z0<=z<=z1:
            t=(z-z0)/(z1-z0)
            return r0*(1-t)+r1*t+.00065*math.sin(3*a+.5)+.00035*math.cos(7*a)
    return .1

def curved_strip(obj,a0,a1,zlo,zhi,depth,offset,steps):
    vs=[]; fs=[]
    for dr in (offset,offset+depth):
        for z in (zlo,zhi):
            for i in range(steps+1):
                a=math.radians(a0+(a1-a0)*i/steps)
                r=outer_radius(z,a)+dr
                vs.append((r*math.cos(a),r*math.sin(a),z))
    s=steps+1
    for i in range(steps):
        fs.extend([(i,i+1,s+i+1,s+i),(2*s+i,3*s+i,3*s+i+1,2*s+i+1),
                   (i,2*s+i,2*s+i+1,i+1),(s+i,s+i+1,3*s+i+1,3*s+i)])
    fs.extend([(0,s,3*s,2*s),(steps,2*s+steps,3*s+steps,s+steps)])
    replace_mesh(obj,vs,fs,[brass]); kit.bevel(obj,width=.00055,segments=2)

curved_strip(band,-145,-90,.100,.113,.0015,-.0003,16)
for label,a in [('left',-143),('right',-92)]:
    me=bpy.data.meshes.new('repair_end_'+label+'_mesh')
    tab=bpy.data.objects.new('mortar_repair_end_'+label,me); bpy.context.collection.objects.link(tab)
    tab.parent=root; tab.matrix_basis=body.matrix_basis.copy(); tab.matrix_parent_inverse=body.matrix_parent_inverse.copy()
    curved_strip(tab,a-3.1,a+3.1,.096,.117,.0014,.0008,4)
    for n,z in enumerate((.101,.112)):
        aa=math.radians(a); radius=outer_radius(z,aa)+.0021
        rivet=kit.lathe('mortar_repair_rivet_'+label+'_'+str(n+1),[(.0018,0),(.0023,.0005),(.002,.0013),(.0012,.0018),(.0002,.00195)],segments=10,material=brass)
        rivet.parent=root; rivet.matrix_parent_inverse=Matrix.Identity(4)
        rivet.location=body.location+Vector((radius*math.cos(aa),radius*math.sin(aa),z))
        rivet.rotation_euler=Vector((math.cos(aa),math.sin(aa),.1)).to_track_quat('Z','Y').to_euler()

# The existing pestle assembly/pivot is retained. Replace its continuous tool
# mesh with a rounded working end, waisted shaft, and flattened palm cap.
def radial_mesh(obj,prof,N,mat,asym=False):
    vs=[]; fs=[]
    for j,(r,z) in enumerate(prof):
        for i in range(N):
            a=2*math.pi*i/N
            delta=(.00035*math.sin(3*a+j*.3) if asym else 0)
            vs.append(((r+delta)*math.cos(a),(r+delta)*math.sin(a),z))
    for j in range(len(prof)-1):
        for i in range(N):
            k=(i+1)%N
            fs.append((j*N+i,j*N+k,(j+1)*N+k,(j+1)*N+i))
    fs.extend([tuple(reversed(range(N))),tuple((len(prof)-1)*N+i for i in range(N))])
    replace_mesh(obj,vs,fs,[mat])
pp=[(.004,-.018),(.012,-.016),(.020,-.010),(.024,0),(.024,.012),
 (.022,.025),(.019,.045),(.016,.075),(.0145,.102),(.015,.126),
 (.017,.136),(.0225,.141),(.026,.147),(.026,.157),(.023,.163),(.016,.166),(.006,.1665)]
radial_mesh(tool,pp,20,stone,True)
radial_mesh(collar,[(.0157,.121),(.0172,.122),(.0174,.124),(.0168,.125),
 (.017,.132),(.0184,.134),(.0184,.136),(.017,.137)],20,brass)
# Preserve inherited Z scale and world pose; cap is less spherical without
# changing independent assembly identity.
root['pass']='refinement_geometry'
root['dimensions_intent']='mortar diameter .20m, rim height .14m, total approx .24m'
root['remaining_work']='UV layout and texture/normal authoring deferred to surface stage.'
pestle['pivot_intent']='centre of lower grinding tip; local X/Y tilt, local Z lift'
# Exercise transforms and confirm actual child world matrices follow rigidly.
bpy.context.view_layer.update()
rest=pestle.matrix_basis.copy()
child_rest={c.name:c.matrix_world.copy() for c in pestle.children}
for axis in (0,1):
    pestle.rotation_euler[axis]+=math.radians(10); bpy.context.view_layer.update()
    assert all(((c.matrix_world @ Vector((0,0,.1)))-(child_rest[c.name] @ Vector((0,0,.1)))).length>.001 for c in pestle.children)
    pestle.matrix_basis=rest.copy(); bpy.context.view_layer.update()
pestle.location+=pestle.rotation_euler.to_matrix()@Vector((0,0,.04)); bpy.context.view_layer.update()
for c in pestle.children:
    assert abs((c.matrix_world.translation-child_rest[c.name].translation).length-.04)<.00001
pestle.matrix_basis=rest.copy(); bpy.context.view_layer.update()
print('PIVOT_TEST','X/Y +10 degrees and local Z +.04m, restored; child matrix assertions passed')
print('REFINED_HIERARCHY',[(o.name,o.parent.name if o.parent else None) for o in root.children],[(c.name,c.parent.name) for c in pestle.children])
finish_asset(material_mode='poly')
