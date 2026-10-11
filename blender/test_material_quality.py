import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import numpy as np
from blender.materials.materialkit import build_material, layer, noise
from blender.materials.materialcalibration import calibrate

class MaterialQualityTests(unittest.TestCase):
    def test_paint_and_layer_channel_coupling(self):
        params={'size':64,'recipe':'painted_metal','wear':0}
        base=build_material(params)
        self.assertEqual(float(base['metallic'].max()),0)
        coating=build_material({**params,'wear':1})
        mask=np.zeros((64,64),np.float32);mask[:,32:]=1
        combined=layer(base,coating,mask,1)
        np.testing.assert_allclose(combined['albedo'][:,:32],base['albedo'][:,:32])
        np.testing.assert_allclose(combined['metallic'][:,32:],coating['metallic'][:,32:])
        self.assertTrue(np.isfinite(combined['normal']).all())

    def test_world_frequency_and_unresolved_features(self):
        np.testing.assert_allclose(noise(64,12,3),noise(128,12,3)[::2,::2],atol=1e-4)
        result=build_material({'size':64,'featureMm':.5})
        self.assertEqual(result['particles'],0)
        self.assertTrue(any('unresolved' in w for w in result['warnings']))

    def test_calibration_is_optional_and_preserves_height(self):
        corpus=json.loads((pathlib.Path(__file__).parent/'materials/calibration-targets.json').read_text())
        result=build_material({'recipe':'wood','size':64})
        unchanged,report=calibrate(result,'wood',0,corpus)
        self.assertIs(unchanged,result);self.assertFalse(report['applied'])
        changed,report=calibrate(result,'wood',.5,corpus)
        self.assertTrue(report['applied']);np.testing.assert_array_equal(changed['height'],result['height'])
        _,report=calibrate(result,'sand',1,corpus);self.assertEqual(report['reason'],'unsupported class')

    def test_cache_hit_corruption_and_failed_build_retention(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)/'bundle';root.mkdir()
            for path in (pathlib.Path(__file__).parent/'materials').iterdir():
                if path.is_file():shutil.copy2(path,root/path.name)
            (root/'params.json').write_text(json.dumps({'recipe':'wood','size':64}))
            (root/'asset.py').write_text("from materialkit import build_material\nfrom pathlib import Path\ndef build(params):\n    with Path(__file__).with_name('calls.txt').open('a') as f:f.write('x')\n    return build_material(params)\n")
            env={**os.environ,'STUDIO_MATERIAL_CACHE':str(pathlib.Path(directory)/'cache')}
            def run():return subprocess.run([sys.executable,str(root/'render.py')],env=env,capture_output=True)
            self.assertEqual(run().returncode,0)
            before=(root/'output/albedo.png').read_bytes()
            self.assertEqual(run().returncode,0);self.assertEqual((root/'calls.txt').read_text(),'x')
            cache=next((pathlib.Path(directory)/'cache').iterdir());(cache/'albedo.png').write_bytes(b'corrupt')
            self.assertEqual(run().returncode,0);self.assertEqual((root/'calls.txt').read_text(),'xx')
            (root/'asset.py').write_text("raise RuntimeError('intentional script error')")
            self.assertNotEqual(run().returncode,0)
            self.assertEqual((root/'output/albedo.png').read_bytes(),before)
            self.assertEqual(json.loads((root/'failure.json').read_text())['kind'],'script')

if __name__=='__main__':unittest.main()
