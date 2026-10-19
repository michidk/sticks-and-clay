import bpy, math, random, os, json, struct
import numpy as np
from mathutils import Vector
import assetkit as kit

# Materials pass: preserve the approved source and semantic assembly.
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/40801013-17ca-4fc9-b236-b93cca8ff161/source.blend')
rng=random.Random(PARAMS.get('seed',1))
root=bpy.data.objects['Mortar_Root']
body=bpy.data.objects['mortar_body']
tool=bpy.data.objects['pestle_stone']
pestle=bpy.data.objects['Pestle']
meshes=[o for o in bpy.data.objects if o.type=='MESH' and (o.parent==root or o.parent==pestle)]
print('SOURCE_PARTS',[(o.name,len(o.data.vertices),len(o.data.uv_layers),[m.name for m in o.data.materials]) for o in meshes])
print('SOURCE_IMAGES',[(i.name,i.filepath) for i in bpy.data.images])

# Judge-requested restricted change: stagger existing external vertices only.
# Underside, inner cavity, rim, strap seating region and topology are preserved.
for v in body.data.vertices:
    x,y,z=v.co; r=math.hypot(x,y); a=math.atan2(y,x)
    if .033<z<.093 and r>.063 and r>(.064+(z-.033)*.45):
        fade=min(1,(z-.033)/.012,(.093-z)/.012)
        dz=.0018*math.sin(7*a+z*155)+.00085*math.cos(11*a-z*100)
        dr=.00065*math.sin(5*a+z*130)
        v.co.z+=dz*fade
        if r: v.co.x*=1+dr*fade/r; v.co.y*=1+dr*fade/r
body.data.update()

# Texture service was unavailable (ECONNREFUSED). These are deterministic
# authored raster fallbacks, NOT image-API generated textures.
texdir=os.path.join(OUTPUT_DIR,'textures'); os.makedirs(texdir,exist_ok=True)
def save_image(name,rgb,noncolor=False):
    h,w=rgb.shape[:2]
    image=bpy.data.images.new(name,width=w,height=h,alpha=True)
    if noncolor: image.colorspace_settings.name='Non-Color'
    rgba=np.ones((h,w,4),dtype=np.float32); rgba[:,:,:3]=rgb
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw=os.path.join(texdir,name+'.png'); image.file_format='PNG'; image.save(); image.pack()
    return image

def fields(size,seed,brass=False):
    rr=np.random.default_rng(seed)
    yy,xx=np.mgrid[0:size,0:size].astype(float)/size
    broad=np.zeros_like(xx); fine=np.zeros_like(xx)
    for k in range(24):
        a=int(rr.integers(1,9)); b=int(rr.integers(-8,9)); phase=rr.uniform(0,6.283)
        broad+=np.sin(2*np.pi*(a*xx+b*yy)+phase)/24
    for k in range(22):
        a=int(rr.integers(30,100)); b=int(rr.integers(-90,90)); phase=rr.uniform(0,6.283)
        fine+=np.sin(2*np.pi*(a*xx+b*yy)+phase)/22
    flecks=np.zeros_like(xx); relief=np.zeros_like(xx)
    for k in range(200 if brass else 380):
        x,y=rr.random(2); rad=rr.uniform(.0008,.003)
        dx=(xx-x+.5)%1-.5; dy=(yy-y+.5)%1-.5
        g=np.exp(-((dx/rad)**2+(dy/(rad*.65))**2)*2)
        flecks+=g*rr.uniform(-.035,.055)
        relief-=g*rr.uniform(.000003,.000014)
    # Independent physical grain relief, not a derivative of the color flecks.
    relief+=fine*(.000010 if brass else .000025)
    # Few shallow interrupted tool traces; periodic placement, no ring patterns.
    for k in range(12):
        x,y=rr.random(2); dx=(xx-x+.5)%1-.5; dy=(yy-y+.5)%1-.5
        trace=np.exp(-(dx/rr.uniform(.005,.018))**6-((dy+.15*dx)/.0007)**2)
        relief-=trace*(.000004 if brass else .000009)
    tint=np.array([.57,.42,.22] if brass else [.48,.455,.415])
    rgb=np.clip(tint+broad[:,:,None]*(.13 if brass else .085)+fine[:,:,None]*.018+flecks[:,:,None],0,1)
    # Normals use metric gradients of actual synthetic micrometre-scale relief.
    tile=.10 if brass else .20
    dx=(np.roll(relief,-1,1)-np.roll(relief,1,1))/(2*tile/size)
    dy=(np.roll(relief,-1,0)-np.roll(relief,1,0))/(2*tile/size)
    def normal(strength):
        n=np.stack((-dx*strength,-dy*strength,np.ones_like(dx)),axis=-1)
        n/=np.linalg.norm(n,axis=-1,keepdims=True)
        return n*.5+.5
    return rgb,normal(1),normal(.25)
stone_rgb,stone_n,worn_n=fields(1024,PARAMS.get('seed',1)+20)
brass_rgb,brass_n,_=fields(512,PARAMS.get('seed',1)+27,True)
stonebase=save_image('hollowmere_stone_basecolor_authored',stone_rgb)
stonenorm=save_image('hollowmere_stone_normal_authored',stone_n,True)
wornnorm=save_image('hollowmere_stone_contact_normal_authored',worn_n,True)
brassbase=save_image('hollowmere_brass_basecolor_authored',brass_rgb)
brassnorm=save_image('hollowmere_brass_normal_authored',brass_n,True)

def material(name,base,normal,rough,metal):
    m=bpy.data.materials.new(name); m.use_nodes=True
    nodes=m.node_tree.nodes; bs=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    bs.inputs['Roughness'].default_value=rough; bs.inputs['Metallic'].default_value=metal
    bc=nodes.new('ShaderNodeTexImage'); bc.name='basecolor_packed'; bc.image=base
    nt=nodes.new('ShaderNodeTexImage'); nt.name='tangent_normal_packed'; nt.image=normal
    nm=nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=.7
    m.node_tree.links.new(bc.outputs['Color'],bs.inputs['Base Color'])
    m.node_tree.links.new(nt.outputs['Color'],nm.inputs['Color']); m.node_tree.links.new(nm.outputs['Normal'],bs.inputs['Normal'])
    return m
stone=material('stone_warm_gray',stonebase,stonenorm,.84,0)
worn=material('stone_ground_contact',stonebase,wornnorm,.66,0)
brass=material('brass_aged_repair',brassbase,brassnorm,.51,.72)

# Continuous circumferential strips: hidden +X seam, profile-distance V.
# One stone family spans 20cm; brass 10cm. Contact patches keep the same color.
profile=[(0,0),(.060,0),(.068,.0025),(.071,.006),(.0715,.013),(.070,.019),(.066,.024),(.0625,.027),(.065,.031),(.073,.040),(.0815,.052),(.089,.067),(.095,.084),(.099,.103),(.1005,.119),(.100,.131),(.0985,.137),(.094,.140),(.086,.140),(.082,.138),(.0795,.133),(.078,.122),(.074,.104),(.067,.085),(.056,.067),(.042,.054),(.027,.048),(.013,.046),(0,.0455)]
lengths=[0]
for p,q in zip(profile[:-1],profile[1:]): lengths.append(lengths[-1]+math.dist(p,q))
def profile_v(co):
    r=math.hypot(co.x,co.y); z=co.z
    j=min(range(len(profile)),key=lambda j:(profile[j][0]-r)**2+(profile[j][1]-z)**2)
    return lengths[j]/.20
for ob in meshes:
    isstone=ob in (body,tool)
    ob.data.materials.clear(); ob.data.materials.append(stone if isstone else brass)
    if isstone: ob.data.materials.append(worn)
    uv=ob.data.uv_layers.active or ob.data.uv_layers.new(name='surface_uv')
    uv.name='surface_uv'
    tile=.20 if isstone else .10
    radius=.095 if ob==body else (.019 if ob==tool else (.017 if 'collar' in ob.name else (.098 if 'repair_band' in ob.name or 'repair_end' in ob.name else .002)))
    for poly in ob.data.polygons:
        cs=[ob.data.vertices[ob.data.loops[li].vertex_index].co for li in poly.loop_indices]
        center=sum(cs,Vector())/len(cs)
        planar=(ob==body and (center.z<.001 or (center.z<.055 and math.hypot(center.x,center.y)<.045))) or (ob==tool and abs(poly.normal.z)>.8)
        angles=[(math.atan2(c.y,c.x)%(2*math.pi))/(2*math.pi) for c in cs]
        if max(angles)-min(angles)>.5: angles=[a+1 if a<.5 else a for a in angles]
        for li,c,a in zip(poly.loop_indices,cs,angles):
            if planar: uv.data[li].uv=(c.x/tile+.5,c.y/tile+.5)
            else: uv.data[li].uv=(a*2*math.pi*radius/tile,profile_v(c) if ob==body else c.z/tile)
        if ob==body:
            radial=Vector((center.x,center.y,0))
            if center.z<.088 and (poly.normal.dot(radial)<0 or (poly.normal.z>.1 and math.hypot(center.x,center.y)<.044)): poly.material_index=1
        elif ob==tool and center.z<.025: poly.material_index=1

# Test preserved independent assembly, then restore exactly.
bpy.context.view_layer.update()
rest=pestle.matrix_basis.copy(); child_rest={c.name:c.matrix_world.copy() for c in pestle.children}
for axis in (0,1):
    pestle.rotation_euler[axis]+=math.radians(10); bpy.context.view_layer.update()
    assert all(((c.matrix_world@Vector((0,0,.1)))-(child_rest[c.name]@Vector((0,0,.1)))).length>.001 for c in pestle.children)
    pestle.matrix_basis=rest.copy(); bpy.context.view_layer.update()
pestle.location+=pestle.rotation_euler.to_matrix()@Vector((0,0,.04)); bpy.context.view_layer.update()
for c in pestle.children: assert abs((c.matrix_world.translation-child_rest[c.name].translation).length-.04)<.00001
pestle.matrix_basis=rest.copy(); bpy.context.view_layer.update()
print('PIVOT_TEST_PASSED: local X/Y 10deg, local Z 4cm; attached children follow; rest restored')
print('FINAL_SOURCE_HIERARCHY',[(o.name,o.parent.name if o.parent else None,tuple(o.location)) for o in [root,pestle]+meshes])
root['pass']='materials'
root['texture_provenance']='Image-generation service failed ECONNREFUSED. Deterministic authored raster fallback basecolors and physically derived relief normals; no API-generated image claimed.'
root['remaining_work']='Replace fallback basecolor maps with image-API generated family when service becomes available if required.'
root['surface_notes']='20cm stone tiles, 10cm brass; profile-following strip UV; quieter polished grinding contact normals; subtly staggered exterior wall facets.'
finish_asset(material_mode='textured')
