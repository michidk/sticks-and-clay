"""Optional real Blender import/BMesh regression test: set BLENDER_BIN to run."""
import hashlib, json, os, pathlib, subprocess, tempfile, unittest
from analyze_mesh import analyze

@unittest.skipUnless(os.environ.get('BLENDER_BIN'), 'Set BLENDER_BIN for real import test')
class BlenderAnalysisTests(unittest.TestCase):
    def test_boundaries_seams_and_source_immutability(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            glb, extracted = root/'raw.json', root/'extracted.json'
            import trimesh
            meshes = [('Closed cube with UV and normal seams', trimesh.creation.box()),
                      ('Intentional open plane', trimesh.Trimesh(vertices=[[0,0,0],[1,0,0],[1,1,0],[0,1,0]], faces=[[0,1,2],[0,2,3]], process=False))]
            glb.write_text(json.dumps([dict(name=name, vertices=m.vertices.tolist(), faces=m.faces.tolist(),
                faceRefs=[dict(primitive=0, triangle=i) for i in range(len(m.faces))], uvBindings=[], topology={}) for name,m in meshes]))
            common = [os.environ['BLENDER_BIN'], '--background', '--factory-startup', '--python-exit-code', '1']
            before = hashlib.sha256(glb.read_bytes()).hexdigest()
            subprocess.run(common+['--python', str(pathlib.Path(__file__).with_name('analyze_extract.py').resolve()), '--', str(glb), str(extracted)], check=True, capture_output=True, timeout=90)
            result = analyze(json.loads(extracted.read_text()))
            self.assertEqual(before, hashlib.sha256(glb.read_bytes()).hexdigest())
            self.assertEqual([f for f in result['findings'] if f['object'].startswith('Closed cube')], [])
            boundary = [f for f in result['findings'] if f['code'] == 'open_boundary']
            self.assertEqual(len(boundary), 1)
            self.assertEqual(boundary[0]['count'], 4)
            self.assertTrue(boundary[0]['faces'])

if __name__ == '__main__': unittest.main()
