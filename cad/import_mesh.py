"""Fixed Blender mesh importer. Retains the uploaded file; exports a meter-space GLB."""
import pathlib
import sys
import runpy
import bpy

source, destination, units, views = sys.argv[sys.argv.index('--') + 1:]
extension = pathlib.Path(source).suffix.lower()
bpy.ops.wm.read_factory_settings(use_empty=True)
if extension == '.blend':
    bpy.ops.wm.open_mainfile(filepath=source)
elif extension == '.glb':
    bpy.ops.import_scene.gltf(filepath=source)
elif extension == '.stl':
    bpy.ops.wm.stl_import(filepath=source)
elif extension == '.obj':
    bpy.ops.wm.obj_import(filepath=source)
else:
    raise ValueError('Unsupported mesh input')
meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
if not meshes:
    raise ValueError('Starting point has no mesh geometry')
if extension in ('.obj', '.stl'):
    factor = {'mm': .001, 'cm': .01, 'm': 1, 'in': .0254}[units]
    from mathutils import Matrix
    for obj in meshes:
        obj.matrix_world = Matrix.Scale(factor, 4) @ obj.matrix_world
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=destination, export_format='GLB', use_selection=True)
sys.argv = ['render_views.py', '--', destination, str(pathlib.Path(destination).parent), *(['iso'] if views == 'iso' else [])]
runpy.run_path(str(pathlib.Path(__file__).with_name('render_views.py')), run_name='__main__')
