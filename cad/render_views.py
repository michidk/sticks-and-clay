"""Independent deterministic photographs of the exported CAD GLB."""
import pathlib
import sys
import bpy
from mathutils import Vector

source, output, *selected = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 8
scene.render.resolution_x = scene.render.resolution_y = 768
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.world = bpy.data.worlds.new('CAD studio')
scene.world.color = (.6, .6, .6)
points = [obj.matrix_world @ Vector(c) for obj in scene.objects if obj.type == 'MESH' for c in obj.bound_box]
low = Vector([min(v[i] for v in points) for i in range(3)])
high = Vector([max(v[i] for v in points) for i in range(3)])
center = (low + high) / 2
span = max(high - low)
for location, energy, size in [((2, -3, 4), 500, 3), ((-3, 1, 2), 250, 4)]:
    light = bpy.data.lights.new('Softbox', 'AREA'); light.energy = energy; light.shape = 'DISK'; light.size = size
    obj = bpy.data.objects.new('Softbox', light); scene.collection.objects.link(obj)
    obj.location = center + Vector(location) * max(span, .1)
    obj.rotation_euler = (center - obj.location).to_track_quat('-Z', 'Y').to_euler()
camera = bpy.data.cameras.new('Inspection camera'); camera.type = 'ORTHO'; camera.ortho_scale = span * 1.75
camera.clip_start = max(span / 1000, .00001); camera.clip_end = max(span * 100, 100)
obj = bpy.data.objects.new('Inspection camera', camera); scene.collection.objects.link(obj); scene.camera = obj
views = {'front': (0, -1, 0), 'rear': (0, 1, 0), 'left': (-1, 0, 0), 'right': (1, 0, 0),
         'top': (0, 0, 1), 'bottom': (0, 0, -1), 'iso': (1, -1, .8)}
for name, direction in views.items():
    if selected and name not in selected:
        continue
    delta = Vector(direction).normalized()
    obj.location = center + delta * max(span * 4, .1)
    obj.rotation_euler = (-delta).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(pathlib.Path(output) / (name + '.png'))
    bpy.ops.render.render(write_still=True)
