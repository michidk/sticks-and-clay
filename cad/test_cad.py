import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from cad.cadcore import check, execute, measure

SOURCE = '''import cadquery as cq
result = cq.Workplane("XY").box(40,30,10).faces(">Z").workplane().hole(6)
show_object(result, options={"name":"bracket"})
'''


class CadTests(unittest.TestCase):
    def test_valid_geometry_and_analytic_bore_measurements(self):
        metrics = measure(execute(SOURCE))
        self.assertEqual(metrics['parts'], ['bracket'])
        self.assertEqual(metrics['solidCount'], 1)
        self.assertEqual(metrics['dimensionsMm'], {'x': 40, 'y': 30, 'z': 10})
        bores = [c for c in metrics['cylindricalFaces'] if c['bore']]
        self.assertEqual(len(bores), 1)
        self.assertAlmostEqual(bores[0]['diameterMm'], 6)
        checks = check(metrics, [{'name': 'width', 'kind': 'x', 'value': 40, 'tolerance': .01},
                                 {'name': 'bore', 'kind': 'bore_diameter', 'value': 8, 'tolerance': .01}])
        self.assertEqual([c['state'] for c in checks], ['passed', 'failed'])

    def test_empty_output_and_broken_source_fail(self):
        for source in ('import cadquery as cq', 'raise ValueError("bad feature")'):
            with self.assertRaises((ValueError, RuntimeError)):
                execute(source)
        self.assertTrue(measure(execute(SOURCE.replace('show_object(result, options={"name":"bracket"})', '')))['valid'])

    @unittest.skipUnless(os.environ.get('BLENDER_BIN'), 'Set BLENDER_BIN to render CAD photographs')
    def test_real_exports_views_roundtrip_and_failure_preserves_previous(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in ('runner.py', 'cadcore.py', 'render_views.py'):
                shutil.copy2(pathlib.Path(__file__).parent / name, root / name)
            shutil.copy2(pathlib.Path(__file__).parent.parent / 'blender/build_runtime.py', root / 'build_runtime.py')
            (root / 'asset.py').write_text(SOURCE)
            (root / 'spec.json').write_text(json.dumps({'requirements': [{'name': 'width', 'kind': 'x', 'value': 40, 'tolerance': .01, 'required': True}]}))
            command = [sys.executable, str(root / 'runner.py'), '--blender', os.environ['BLENDER_BIN']]
            run = subprocess.run(command, cwd=root, capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout[-2000:] + run.stderr[-3000:])
            output = root / 'output'
            metrics = json.loads((output / 'metrics.json').read_text())
            self.assertTrue(metrics['stepRoundTrip']['valid'])
            self.assertTrue(metrics['mesh']['watertight'])
            for name in ('front', 'rear', 'left', 'right', 'top', 'bottom', 'iso'):
                self.assertGreater((output / (name + '.png')).stat().st_size, 100)
            before = (output / 'asset.step').read_bytes()
            imported = execute('import cadquery as cq\nresult = cq.importers.importStep(' + repr(str(output / 'asset.step')) + ')')
            self.assertAlmostEqual(measure(imported)['volumeMm3'], metrics['volumeMm3'], places=5)
            (root / 'asset.py').write_text('raise ValueError("broken revision")')
            self.assertNotEqual(subprocess.run(command, cwd=root, capture_output=True).returncode, 0)
            self.assertEqual((output / 'asset.step').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
