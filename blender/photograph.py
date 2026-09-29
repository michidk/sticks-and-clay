"""Controlled photography of the delivery GLB. Never saves or edits the source asset."""
import bpy, math, json, hashlib
from pathlib import Path
from mathutils import Vector


def photograph(glb, destination, front_azimuth=-55, elevation=25, framing=1.2, exposure=0, coverage=None):
    destination = Path(destination)
    collection = isinstance(glb, list)
    assets = glb if collection else [{'path': str(glb)}]
    hashes = {item['path']: hashlib.sha256(Path(item['path']).read_bytes()).hexdigest() for item in assets}
    digest = next(iter(hashes.values()))
    receipt = destination / 'photography.json'
    receipt.unlink(missing_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    groups = []
    for item in assets:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=item['path'])
        objects = set(bpy.data.objects) - before
        roots = [o for o in objects if o.parent not in objects]
        corners = [o.matrix_world @ Vector(c) for o in objects if o.type == 'MESH' for c in o.bound_box]
        if not corners: raise ValueError('Empty collection asset')
        low = Vector([min(p[i] for p in corners) for i in range(3)])
        high = Vector([max(p[i] for p in corners) for i in range(3)])
        groups.append((roots, low, high))
    if len(groups) > 1:
        columns = min(len(groups), math.ceil(math.sqrt(len(groups) * 16 / 9)))
        width = max((hi-lo).x for _,lo,hi in groups) * 1.4
        depth = max((hi-lo).y for _,lo,hi in groups) * 1.5
        spacing = max(width, depth, .1)
        azimuth = math.radians(front_azimuth)
        right = Vector((-math.sin(azimuth), math.cos(azimuth), 0))
        back = Vector((-math.cos(azimuth), -math.sin(azimuth), 0))
        for index, (roots, low, high) in enumerate(groups):
            # Compose rows across the hero camera, not diagonally into its depth.
            position = right * (index % columns) * spacing + back * (index // columns) * spacing
            offset = position - Vector(((low.x+high.x)/2, (low.y+high.y)/2, low.z))
            for obj in roots: obj.location += offset
        bpy.context.view_layer.update()
    scene = bpy.context.scene
    meshes = [o for o in scene.objects if o.type == 'MESH']
    if not meshes:
        raise ValueError('Export contains no meshes')
    points = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector([min(p[i] for p in points) for i in range(3)])
    hi = Vector([max(p[i] for p in points) for i in range(3)])
    center = (lo + hi) / 2
    span = max(hi - lo)
    if span <= 0:
        raise ValueError('Export has empty bounds')
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1280 if collection else 1024
    scene.render.resolution_y = 720 if collection else 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = exposure
    scene.world = bpy.data.worlds.new('Photography world')
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (.35, .35, .35, 1)
    bg.inputs['Strength'].default_value = .45
    bpy.ops.mesh.primitive_plane_add(size=span * 200, location=(center.x, center.y, lo.z))
    floor = bpy.context.object
    mat = bpy.data.materials.new('Neutral studio floor')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (.32, .35, .30, 1) if collection else (.19, .19, .19, 1)
    bsdf.inputs['Roughness'].default_value = .85
    floor.data.materials.append(mat)
    for position, energy, size in [((2,-3,4),1100,2),((-3,-1,2),850,3),((0,3,3),1000,2)]:
        bpy.ops.object.light_add(type='AREA', location=center + Vector(position)*span)
        lamp=bpy.context.object
        lamp.data.energy=energy*span**2/4
        lamp.data.shape='DISK';lamp.data.size=size*span
        lamp.rotation_euler=(center-lamp.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add()
    camera=bpy.context.object;scene.camera=camera
    camera.data.type='ORTHO';camera.data.clip_start=max(.0001,span/10000);camera.data.clip_end=span*500
    views = [('front',front_azimuth,elevation),('rear',front_azimuth+180,elevation),('detail',front_azimuth+25,max(10,elevation-10))]
    if coverage and len(coverage) > 3:
        views += [('left',front_azimuth+90,0),('right',front_azimuth-90,0),
                  ('top',front_azimuth,90),('bottom',front_azimuth,-90)]
    for name, azimuth, altitude in views:
        # Hide only the studio floor for underside inspection; asset stays intact.
        floor.hide_render = name == 'bottom'
        azimuth,altitude=math.radians(azimuth),math.radians(altitude)
        direction=Vector((math.cos(azimuth)*math.cos(altitude),math.sin(azimuth)*math.cos(altitude),math.sin(altitude)))
        camera.location=center+direction*span*4
        camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
        bpy.context.view_layer.update()
        projected=[camera.matrix_world.inverted()@p for p in points]
        aspect = scene.render.resolution_x / scene.render.resolution_y
        extent=max(max(p.x for p in projected)-min(p.x for p in projected),
                   (max(p.y for p in projected)-min(p.y for p in projected))*aspect)
        shift=Vector(((min(p.x for p in projected)+max(p.x for p in projected))/2,
                      (min(p.y for p in projected)+max(p.y for p in projected))/2,0))
        camera.location += camera.rotation_euler.to_matrix() @ shift
        camera.data.ortho_scale=extent*(max(1.02,framing*.88) if name=='detail' else framing)
        scene.render.filepath=str(destination/f'{name}.png')
        bpy.ops.render.render(write_still=True)
    if any(hashlib.sha256(Path(path).read_bytes()).hexdigest()!=digest for path,digest in hashes.items()):
        raise ValueError('Source export changed during photography')
    receipt.write_text(json.dumps({'glbSha256':digest,'assets':hashes,'settings':{'frontAzimuth':front_azimuth,'elevation':elevation,'framing':framing,'exposure':exposure},
        'images':{name:hashlib.sha256((destination/f'{name}.png').read_bytes()).hexdigest() for name,_,_ in views}}))
