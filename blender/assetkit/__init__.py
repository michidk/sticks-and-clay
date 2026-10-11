"""Small deterministic construction vocabulary. Ordinary bpy objects, no PBR recipes."""
import math
import random
import bpy
from mathutils import Vector

VERSION = "1.0.0"


def parent(obj, to):
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = to
    obj.matrix_world = world
    return obj


def root(name="Asset"):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj["asset_root"] = True
    return obj


def pivot(obj, position):
    """Move the origin without moving the visible geometry or its children."""
    position = Vector(position)
    bpy.context.view_layer.update()
    children = [(c, c.matrix_world.copy()) for c in obj.children]
    if obj.type == 'MESH':
        local = obj.matrix_world.inverted() @ position
        obj.data = obj.data.copy()
        for vertex in obj.data.vertices:
            vertex.co -= local
    obj.matrix_world.translation = position
    bpy.context.view_layer.update()
    for child, world in children:
        child.matrix_world = world
    return obj


def mesh(name, vertices, faces, material=None, owner=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    if material:
        data.materials.append(material)
    if owner:
        parent(obj, owner)
    return obj


def bevel(obj, width=.03, segments=2):
    if width <= 0:
        return obj
    mod = obj.modifiers.new("Edge radius", 'BEVEL')
    mod.width, mod.segments = width, max(1, segments)
    mod.limit_method = 'ANGLE'
    return obj


def rounded_box(name, size=(1, 1, 1), location=(0, 0, 0), radius=.04, material=None, owner=None):
    x, y, z = [float(v) / 2 for v in size]
    if min(x, y, z) <= 0:
        raise ValueError("Box dimensions must be positive")
    obj = mesh(name, [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)],
               [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)], material)
    obj.location = location
    bevel(obj, min(radius, min(x,y,z) / 2))
    if owner:
        parent(obj, owner)
    return obj


def extrude(name, profile, depth, material=None, owner=None):
    """Extrude a counterclockwise XY profile along Z. Supply a simple polygon."""
    if len(profile) < 3 or depth <= 0:
        raise ValueError("Extrusion needs a polygon and positive depth")
    n = len(profile)
    vertices = [(x,y,z) for z in (0,depth) for x,y in profile]
    faces = [tuple(reversed(range(n))), tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name, vertices, faces, material, owner)


def lathe(name, profile, segments=24, material=None, owner=None):
    """Closed radial profile of (radius, z), ordered bottom to top."""
    if len(profile) < 2 or segments < 3 or any(r <= 0 for r,z in profile):
        raise ValueError("Lathe needs positive-radius rings and at least three segments")
    vertices = [(r*math.cos(i*math.tau/segments),r*math.sin(i*math.tau/segments),z)
                for r,z in profile for i in range(segments)]
    faces = [tuple(reversed(range(segments))), tuple(range((len(profile)-1)*segments,len(vertices)))]
    for j in range(len(profile)-1):
        for i in range(segments):
            a, b = j*segments+i, j*segments+(i+1)%segments
            faces.append((a,b,b+segments,a+segments))
    return mesh(name, vertices, faces, material, owner)


def loft(name, rings, material=None, owner=None):
    """Join equal-sized, consistently wound XYZ rings; cap both ends."""
    if len(rings) < 2 or len(rings[0]) < 3 or any(len(r) != len(rings[0]) for r in rings):
        raise ValueError("Loft needs equally sized rings")
    n = len(rings[0])
    vertices = [tuple(p) for ring in rings for p in ring]
    faces = [tuple(reversed(range(n))), tuple(range(len(vertices)-n,len(vertices)))]
    for j in range(len(rings)-1):
        faces.extend((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for i in range(n))
    return mesh(name, vertices, faces, material, owner)


def tube(name, points, radii=.1, segments=12, material=None, owner=None):
    """Tapered path; useful for branches, limbs, rails and cables."""
    pts = [Vector(p) for p in points]
    rs = [radii]*len(pts) if isinstance(radii, (int,float)) else list(radii)
    if len(pts) < 2 or len(rs) != len(pts) or min(rs) <= 0 or segments < 3:
        raise ValueError("Tube needs a path and positive radius per point")
    rings = []
    for i, p in enumerate(pts):
        tangent = pts[min(i+1,len(pts)-1)]-pts[max(0,i-1)]
        if tangent.length < 1e-8:
            raise ValueError("Tube path contains coincident points")
        rotation = tangent.to_track_quat('Z','Y')
        rings.append([p + rotation @ Vector((rs[i]*math.cos(k*math.tau/segments),rs[i]*math.sin(k*math.tau/segments),0)) for k in range(segments)])
    return loft(name, rings, material, owner)


def rock(name, size=(1,1,1), seed=1, material=None, owner=None):
    rng = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2)
    obj = bpy.context.object
    obj.name = name
    for vertex in obj.data.vertices:
        vertex.co *= rng.uniform(.82,1.12)
        vertex.co.x *= size[0]/2
        vertex.co.y *= size[1]/2
        vertex.co.z *= size[2]/2
    if material:
        obj.data.materials.append(material)
    if owner:
        parent(obj,owner)
    return obj


def tree(name, height=3, seed=1, bark=None, leaves=None):
    """Starting structure, not a finished species: edit trunk, branches and crown masses."""
    rng = random.Random(seed)
    group = root(name)
    tube(name+"_trunk",[(0,0,0),(.03,0,height*.5),(0,.05,height*.9)],[height*.075,height*.05,height*.015],material=bark,owner=group)
    for i in range(5):
        angle = i*math.tau/5+rng.uniform(-.15,.15)
        start = (0,0,height*(.4+i*.07))
        end = (math.cos(angle)*height*.3,math.sin(angle)*height*.3,height*(.65+i*.045))
        tube(name+f"_branch_{i}",[start,end],[height*.025,height*.008],material=bark,owner=group)
        crown = rock(name+f"_crown_{i}",(height*.65,height*.6,height*.45),seed+i,leaves,group)
        crown.location = end
    return group


def color_material(name, color=(.5,.5,.5,1), roughness=.6, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    shader.inputs['Base Color'].default_value = color
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    return mat


def image_material(name, base_color, normal, roughness=.6, metallic=0):
    """Bind supplied image maps; does not generate textures or infer normals from color."""
    mat = color_material(name,roughness=roughness,metallic=metallic)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    for path, is_normal in [(base_color,False),(normal,True)]:
        image = bpy.data.images.load(str(path),check_existing=True)
        image.colorspace_settings.name = 'Non-Color' if is_normal else 'sRGB'
        image.pack()
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = image
        if is_normal:
            mapping = nodes.new('ShaderNodeNormalMap')
            links.new(texture.outputs['Color'],mapping.inputs['Color'])
            links.new(mapping.outputs['Normal'],shader.inputs['Normal'])
        else:
            links.new(texture.outputs['Color'],shader.inputs['Base Color'])
    return mat


def unwrap(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(island_margin=.025)
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def socket(name, position, owner, forward=(0,-1,0)):
    if not name.startswith('socket_'):
        raise ValueError("Socket names start with socket_")
    obj = bpy.data.objects.new(name,None)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = Vector(forward).to_track_quat('-Y','Z').to_euler()
    obj["asset_socket"] = True
    return parent(obj,owner)


def allow_overlap(a,b,reason):
    if not reason.strip():
        raise ValueError("Intentional overlap needs a reason")
    a["allowed_overlap_"+b.name] = reason
    b["allowed_overlap_"+a.name] = reason


def open_surface(obj,reason):
    obj["open_surface_reason"] = reason
    return obj


def grid_piece(obj,cells,cell_size=1):
    if cell_size <= 0 or any(c < 0 or int(c) != c for c in cells):
        raise ValueError("Grid dimensions use nonnegative whole cells")
    obj["grid_cells"], obj["grid_size"] = list(cells),cell_size
    return obj


def collider(obj,shape="convex"):
    if shape not in ('convex','box','sphere','mesh'):
        raise ValueError("Unknown collider shape")
    obj["collider_shape"] = shape
    return obj


def slot(owner,name,socket_name,accepts):
    import json
    owner["slot_"+name] = json.dumps({"socket":socket_name,"accepts":list(accepts)})


def clip(name,start,end,loop=False):
    """Tag a named NLA clip from the currently authored object actions."""
    import json
    if end <= start:
        raise ValueError("Animation clip needs a positive duration")
    scene = bpy.context.scene
    existing = [json.loads(scene[k]) for k in scene.keys() if k.startswith('clip_')]
    scene.frame_start = int(min([start]+[c['start'] for c in existing]))
    scene.frame_end = int(max([end]+[c['end'] for c in existing]))
    scene["clip_"+name] = json.dumps({"start":start,"end":end,"loop":bool(loop)})
    for obj in scene.objects:
        if obj.animation_data and obj.animation_data.action:
            track = obj.animation_data.nla_tracks.new()
            track.name = name
            strip = track.strips.new(name,int(start),obj.animation_data.action)
            strip.frame_start,strip.frame_end = start,end
            obj.animation_data.action = None


def event(name,frame,owner,socket_name=None):
    import json
    owner["event_"+name+"_"+str(frame)] = json.dumps({"frame":frame,"socket":socket_name})
