import bpy, math, random
from mathutils import Vector
import assetkit as kit

# Paloma blockout: Blender Z-up, front -Y. GLB converts to Y-up/+Z.
rng = random.Random(PARAMS.get('seed', 1))
root = kit.root('Paloma_Sedan')
def color(hexstr):
    v=[int(hexstr[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in v)+(1,)
paint=kit.color_material('Paloma_BodyPaint',color('55A9B8'),roughness=.65)
glass=kit.color_material('Paloma_Glass',color('304A52'),roughness=.65)
rubber=kit.color_material('Paloma_Rubber',color('273334'),roughness=.88)
metal=kit.color_material('Paloma_BumperMetal',color('B9C2BE'),roughness=.65)
head=kit.color_material('Paloma_Headlight',color('F2D9A4'),roughness=.65)
tail=kit.color_material('Paloma_Taillight',color('C64E4B'),roughness=.65)
def mesh(name,vs,fs,mat):
    me=bpy.data.meshes.new(name+'_Mesh');me.from_pydata(vs,[],fs);me.update()
    ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
    ob.parent=root;ob.data.materials.append(mat)
    return ob

def box(name,size,loc,mat,rad=.015):
    return kit.rounded_box(name,size=size,location=loc,radius=rad,material=mat,owner=root)

def apply_mod(ob,mod):
    bpy.context.view_layer.objects.active=ob
    bpy.ops.object.modifier_apply(modifier=mod.name)

# Broad clipped-corner shell. Cylinder subtraction opens all four painted arches.
plan=[(-.78,-2.075),(.78,-2.075),(.88,-1.975),(.88,1.975),(.78,2.075),(-.78,2.075),(-.88,1.975),(-.88,-1.975)]
body=kit.loft('Body_ThreeBox_LowerShell',rings=[[(x,y,.29) for x,y in plan],[(x,y,.93) for x,y in plan]],material=paint,owner=root)
for axle in (-1.30,1.25):
    bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=.465,depth=2.3,location=(0,axle,.38),rotation=(0,math.pi/2,0))
    cutter=bpy.context.object
    mod=body.modifiers.new('Open_Wheel_Arch','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    apply_mod(body,mod);bpy.data.objects.remove(cutter,do_unlink=True)
    # Vertical mouth from the widest part of the arch down through the sill.
    bpy.ops.mesh.primitive_cube_add(size=1,location=(0,axle,.09))
    cutter=bpy.context.object;cutter.dimensions=(2.3,.93,.58)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=body.modifiers.new('Arch_Open_Bottom','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    apply_mod(body,mod);bpy.data.objects.remove(cutter,do_unlink=True)
kit.bevel(body,width=.012,segments=1)
# Almost level tops: the same shell carries the hood and trunk, not stacked slabs.
box('Underbody_Recessed',(1.34,3.71,.13),(0,0,.30),rubber,.025)

# Continuous painted cabin with quiet roof bevel and sloping A/C pillar surfaces.
def cabin_ring(hw,yf,yr,z):
    return [(-hw,yf,z),(hw,yf,z),(hw,yr,z),(-hw,yr,z)]
kit.loft('Cabin_Painted_Pillars_Roof',rings=[cabin_ring(.85,-.90,1.29,.93),cabin_ring(.73,-.42,.91,1.60),cabin_ring(.70,-.38,.87,1.65)],material=paint,owner=root)
# Opaque window surfaces are inset within generous painted framing.
def wid(z):return .85-(z-.93)/.67*.12
def yf(z):return -.90+(z-.93)/.67*.48
def yr(z):return 1.29-(z-.93)/.67*.38
zl=.985;zh=1.555
mesh('Glass_Windshield',[(-wid(zl)+.055,yf(zl)-.003,zl),(wid(zl)-.055,yf(zl)-.003,zl),(wid(zh)-.055,yf(zh)-.003,zh),(-wid(zh)+.055,yf(zh)-.003,zh)],[(0,1,2,3)],glass)
mesh('Glass_RearWindow',[(-wid(zl)+.065,yr(zl)+.003,zl),(-wid(zh)+.065,yr(zh)+.003,zh),(wid(zh)-.065,yr(zh)+.003,zh),(wid(zl)-.065,yr(zl)+.003,zl)],[(0,1,2,3)],glass)
for s,side in [(-1,'L'),(1,'R')]:
    # Two windows per side, divided by the continuous painted B pillar.
    for label,profile in [('Front',[(yf(zl)+.065,zl),(.255,zl),(.255,zh),(yf(zh)+.065,zh)]),('Rear',[(.335,zl),(yr(zl)-.13,zl),(yr(zh)-.13,zh),(.335,zh)])]:
        vs=[(s*(wid(z)+.003),y,z) for y,z in profile]
        faces=[(0,1,2,3)] if s<0 else [(3,2,1,0)]
        ob=mesh('Glass_'+label+'_'+side,vs,faces,glass)
        kit.open_surface(ob,'Opaque window patch seated on solid cabin shell; no interior view')

# Four unified wheel meshes, including tire, plain disc and hub; true axle pivots.
def wheel(name,x,y):
    vs=[];fs=[];mi=[];n=24
    # Axial/radial sections give a restrained shoulder rather than raw cylinders.
    rings=[(-.125,0),(-.125,.085),(-.123,.215),(-.118,.245),(-.125,.285),(-.105,.350),(-.075,.380),(.075,.380),(.105,.350),(.125,.285),(.118,.245),(.123,.215),(.125,.085),(.125,0)]
    for a,r in rings:
        for i in range(n):
            t=2*math.pi*i/n;vs.append((a,r*math.sin(t),r*math.cos(t)))
    for k in range(len(rings)-1):
        for i in range(n):
            j=(i+1)%n;fs.append((k*n+i,k*n+j,(k+1)*n+j,(k+1)*n+i));mi.append(1 if k<3 or k>=10 else 0)
    ob=mesh(name,vs,fs,rubber);ob.data.materials.append(metal)
    for p,m in zip(ob.data.polygons,mi):p.material_index=m
    ob.location=(x,y,.38)
    # Merge collapsed axial poles into proper triangle fans and recalculate winding.
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active=ob;ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.00001);bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT');ob.select_set(False)
    return ob
for name,x,y in [('wheel_fl',-1,-1.30),('wheel_fr',1,-1.30),('wheel_rl',-1,1.25),('wheel_rr',1,1.25)]:wheel(name,x,y)

# Primary front/rear identification only; finer trim remains a refinement task.
box('Bumper_Front',(1.77,.15,.115),(0,-2.075,.47),metal,.025)
box('Bumper_Rear',(1.77,.15,.115),(0,2.075,.47),metal,.025)
box('Grille_Dark',( .89,.025,.20),(0,-2.079,.746),rubber,.006)
for s,side in [(-1,'L'),(1,'R')]:
    box('Headlight_'+side,(.365,.048,.225),(s*.648,-2.073,.757),head,.012)
    box('Taillight_'+side,(.34,.048,.205),(s*.651,2.073,.759),tail,.012)

# Geometry-stage intermediate: flat palette only, no textures or runtime extras.
for name in ['Glass_Windshield','Glass_RearWindow']:
    kit.open_surface(bpy.data.objects[name],'Opaque window patch seated on solid cabin shell; no interior view')
finish_asset(material_mode='poly')
