"""Optional real Blender import/BMesh regression test: set BLENDER_BIN to run."""
import hashlib, json, os, pathlib, subprocess, tempfile, unittest
from analyze_mesh import analyze

@unittest.skipUnless(os.environ.get('BLENDER_BIN'), 'Set BLENDER_BIN for real import test')
class BlenderAnalysisTests(unittest.TestCase):
    def test_boundaries_seams_and_source_immutability(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            glb, extracted = root/'fixture.glb', root/'extracted.json'
            fixture = root/'fixture.py'
            fixture.write_text('''import bpy, sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add()
cube = bpy.context.object
cube.name = 'Closed cube with UV and normal seams'
cube.scale.x = -1
bpy.ops.mesh.primitive_plane_add(location=(4,0,0))
bpy.context.object.name = 'Intentional open plane'
bpy.ops.export_scene.gltf(filepath=sys.argv[-1], export_format='GLB', export_yup=True)
''')
            common = [os.environ['BLENDER_BIN'], '--background', '--factory-startup', '--python-exit-code', '1']
            subprocess.run(common+['--python', str(fixture), '--', str(glb)], check=True, capture_output=True, timeout=90)
            before = hashlib.sha256(glb.read_bytes()).hexdigest()
            subprocess.run(common+['--python', str(pathlib.Path(__file__).with_name('analyze_extract.py').resolve()), '--', str(glb), str(extracted)], check=True, capture_output=True, timeout=90)
            result = analyze(json.loads(extracted.read_text()))
            self.assertEqual(before, hashlib.sha256(glb.read_bytes()).hexdigest())
            self.assertEqual([f for f in result['findings'] if f['object'].startswith('Closed cube')], [])
            boundary = [f for f in result['findings'] if f['code'] == 'open_boundary']
            self.assertEqual(len(boundary), 1)
            self.assertEqual(boundary[0]['count'], 4)
            self.assertTrue(boundary[0]['polygons'])

if __name__ == '__main__': unittest.main()
