import bpy,math,random,json,os,struct
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
def finish_asset(material_mode="textured", sprites=None, lod_ratios=None, **_legacy_options):
    # Saved build scripts may pass retired options; exports have no polygon cap.
    scene=bpy.context.scene
    # Previous sources may contain presentation objects. Never export or duplicate them.
    for obj in list(scene.objects):
        if obj.get('studio_environment'):
            bpy.data.objects.remove(obj,do_unlink=True)
    scene.unit_settings.system='METRIC'
    meshes=[o for o in scene.objects if o.type=='MESH' and not o.get('studio_environment')]
    if not meshes:raise ValueError('Asset has no mesh geometry')
    bpy.context.view_layer.update()
    points=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box]
    lo=Vector([min(p[i] for p in points) for i in range(3)])
    hi=Vector([max(p[i] for p in points) for i in range(3)])
    offset=Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
    # Normalize one asset root, preserving authored local pivots, rigs and sockets.
    import assetkit as kit
    roots=[o for o in scene.objects if o.get('asset_root') and o.parent is None]
    root=roots[0] if len(roots)==1 else kit.root('Asset')
    parts=[o for o in scene.objects if o.type in ('MESH','EMPTY','ARMATURE') and not o.get('studio_environment')]
    for obj in parts:
        if obj != root and obj.parent is None:kit.parent(obj,root)
    root.location-=offset
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:obj.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0]
    for image in bpy.data.images:
        if image.source!='VIEWER':
            try:image.pack()
            except Exception:pass
    tris=0
    for obj in meshes:
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh();mesh.calc_loop_triangles();tris+=len(mesh.loop_triangles);evaluated.to_mesh_clear()
    preview=globals().get('PREVIEW_ONLY',False)
    if not preview:
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUTPUT_DIR,'asset.glb'),export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_extras=True,export_animations=True)
    if preview:
        document={}
        payload=b''
    else:
        payload=open(os.path.join(OUTPUT_DIR,'asset.glb'),'rb').read()
        document=json.loads(payload[20:20+struct.unpack_from('<I',payload,12)[0]])
    if material_mode=='textured' and not preview:
        for mat in document.get('materials',[]):
            if not mat.get('pbrMetallicRoughness',{}).get('baseColorTexture') or not mat.get('normalTexture'):
                raise ValueError('Textured mode requires exported base color and tangent normal maps for material '+mat.get('name','unnamed'))
        if not document.get('materials'):raise ValueError('Textured mesh needs materials')
    elif material_mode=='poly':
        if document.get('images'):raise ValueError('Poly mode must not contain image textures')
    elif material_mode!='textured':raise ValueError('material_mode must be textured or poly')
    if not preview:bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTPUT_DIR,'source.blend'))
    if lod_ratios and not preview:
        from assetkit.lods import export_lods
        export_lods(parts,OUTPUT_DIR,lod_ratios)
    dimensions=list(hi-lo)
    materials=[]
    for mat in {m for o in meshes for m in o.data.materials if m}:
        nodes=list(mat.node_tree.nodes) if mat.use_nodes else []
        materials.append({'name':mat.name,'images':[n.image.name for n in nodes if n.type=='TEX_IMAGE' and n.image],'normalMap':any(n.type=='NORMAL_MAP' for n in nodes)})
    from assetkit.readiness import inspect_asset
    readiness=inspect_asset(parts,dimensions)
    metrics={'triangles':tris,'dimensions':dimensions,'origin':'ground-center','materials':materials,'bytes':len(payload),'blenderVersion':bpy.app.version_string,'helperVersion':kit.VERSION,'readiness':readiness,'preview':preview}
    open(os.path.join(OUTPUT_DIR,'metrics.json'),'w').write(json.dumps(metrics))
    span=max(dimensions);center=Vector((0,0,dimensions[2]/2))
    scene.render.engine='CYCLES';scene.cycles.samples=4 if preview else 16
    scene.render.resolution_x=384 if preview else 768;scene.render.resolution_y=scene.render.resolution_x;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.world.use_nodes=True
    background=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND')
    background.inputs['Color'].default_value=(0.25,0.25,0.25,1)
    background.inputs['Strength'].default_value=0.35
    bpy.ops.mesh.primitive_plane_add(size=span*200,location=(0,0,0))
    floor=bpy.context.object;floor['studio_environment']=True
    mat=bpy.data.materials.new('Studio floor');mat.use_nodes=True
    bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');bsdf.inputs['Base Color'].default_value=(0.13,0.15,0.18,1);bsdf.inputs['Roughness'].default_value=0.85;floor.data.materials.append(mat)
    for loc,energy,size in [((span*2,-span*3,span*4),1100,span*2),((-span*3,-span,span*2),700,span*3),((0,span*3,span*3),900,span*2)]:
        bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light['studio_environment']=True;light.data.energy=energy*span**2/4;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add();camera=bpy.context.object;camera['studio_environment']=True;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=span*1.65
    for name,position,zoom in [('front',(1.3,-1.8,1.1),1),('rear',(-1.4,1.8,1),1),('detail',(0.4,-1.7,0.6),0.8)]:
        camera.location=center+Vector(position)*span;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=span*1.65*zoom;scene.render.filepath=os.path.join(OUTPUT_DIR,name+'.png');bpy.ops.render.render(write_still=True)
    if sprites and not preview:
        from assetkit.sprites import render_sheet
        render_sheet(scene,camera,center,span,OUTPUT_DIR,sprites)
    print('ASSET_STUDIO_FINISHED',json.dumps(metrics))
