import unittest
import numpy as np
import trimesh
from analyze_mesh import analyze

def obj(mesh, textured=False, uv=None):
    return dict(name='fixture', vertices=mesh.vertices.tolist(), faces=mesh.faces.tolist(),
        polygons=list(range(len(mesh.faces))), topology={}, textured=[textured]*len(mesh.faces), uv=uv)

class AnalysisTests(unittest.TestCase):
    def test_clean_box(self):
        self.assertEqual(analyze([obj(trimesh.creation.box())])['findings'], [])
    def test_defects(self):
        mesh = trimesh.creation.box()
        mesh.faces = np.vstack([mesh.faces, mesh.faces[0], [0,0,1]])
        codes = {f['code'] for f in analyze([obj(mesh)])['findings']}
        self.assertTrue({'duplicate_or_coincident_triangles','degenerate_triangles'} <= codes)
    def test_inverted_shell(self):
        mesh = trimesh.creation.box(); mesh.invert()
        self.assertIn('inward_closed_shell', {f['code'] for f in analyze([obj(mesh)])['findings']})
    def test_collapsed_textured_uv(self):
        mesh = trimesh.creation.box()
        codes = {f['code'] for f in analyze([obj(mesh, True, np.zeros((12,3,2)).tolist())])['findings']}
        self.assertIn('collapsed_or_nonfinite_uv', codes)
    def test_crossing_triangles(self):
        mesh = trimesh.Trimesh(vertices=[[-1,-1,0],[1,-1,0],[0,1,0],[0,0,-1],[0,0,1],[0,2,0]], faces=[[0,1,2],[3,4,5]], process=False)
        result = analyze([obj(mesh)])
        self.assertIn('self_intersections', {f['code'] for f in result['findings']})
    def test_input_unchanged(self):
        import copy
        source = [obj(trimesh.creation.box())]; before = copy.deepcopy(source)
        analyze(source)
        self.assertEqual(source, before)

if __name__ == '__main__': unittest.main()
