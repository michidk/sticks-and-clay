import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import numpy as np
from PIL import Image
from blender.materials.materialkit import build_material, check, save, RECIPES


class MaterialTests(unittest.TestCase):
    def test_recipes_repeat_by_seed_and_export_finite_physical_channels(self):
        for recipe in RECIPES:
            with self.subTest(recipe=recipe):
                p=check({'recipe':recipe,'size':64,'seed':43})
                first=build_material(p); repeat=build_material(p)
                for channel in ('albedo','height','normal','roughness','metallic','ao'):
                    np.testing.assert_array_equal(first[channel],repeat[channel])
                    self.assertTrue(np.isfinite(first[channel]).all())
                    self.assertGreaterEqual(first[channel].min(),0)
                    self.assertLessEqual(first[channel].max(),1)
                self.assertAlmostEqual(float(first['height'].mean()),.5,places=5)
                normal=first['normal']*2-1
                np.testing.assert_allclose(np.linalg.norm(normal,axis=-1),1,atol=1e-6)
                self.assertGreater(float(first['height'].std()),0)
                self.assertFalse(np.array_equal(first['height'],build_material({**p,'seed':44})['height']))
                if recipe!='painted_metal': self.assertEqual(float(first['metallic'].max()),0)

    def test_normal_y_and_height_scale_use_wrapped_derivatives(self):
        p=check({'recipe':'sand','size':64,'tileMetres':2,'reliefMm':8})
        result=build_material(p)
        lo,hi=result['heightWindowMm']; mm=result['height']*(hi-lo)+lo
        spacing=p['tileMetres']*1000/p['size']
        expected_y=(np.roll(mm,-1,0)-np.roll(mm,1,0))/(2*spacing)
        normal=result['normal']*2-1
        np.testing.assert_allclose(normal[:,:,1]/normal[:,:,2],expected_y,atol=2e-6)
        self.assertAlmostEqual(float(np.ptp(mm)),8,places=4)

    def test_png_precision_packing_manifest_and_offline_relocation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=pathlib.Path(temporary)
            for name in ('render.py','materialkit.py','materialcore.py','materialcache.py','materialcalibration.py','calibration-targets.json','materialrecipes.py','materialoutput.py','requirements.txt'):
                shutil.copy2(pathlib.Path(__file__).parent/'materials'/name,root/name)
            params=check({'size':64,'recipe':'brick'})
            shutil.copy2(pathlib.Path(__file__).parent/'build_artifacts.py',root/'build_artifacts.py')
            (root/'params.json').write_text(json.dumps(params))
            (root/'asset.py').write_text('from materialkit import build_material\ndef build(params): return build_material(params)\n')
            subprocess.run([sys.executable,str(root/'render.py')],cwd=root,check=True,capture_output=True)
            out=root/'output'; height=(out/'height.png').read_bytes()
            self.assertEqual(height[24],16)
            orm=np.asarray(Image.open(out/'orm.png'))
            for index,name in enumerate(('ao','roughness','metallic')):
                np.testing.assert_array_equal(orm[:,:,index],np.asarray(Image.open(out/(name+'.png'))))
            manifest=json.loads((out/'manifest.json').read_text())
            for name,digest in manifest['files'].items():self.assertEqual(hashlib.sha256((out/name).read_bytes()).hexdigest(),digest)
            before=(out/'albedo.png').read_bytes()
            subprocess.run([sys.executable,str(root/'render.py'),'--mode','quick'],cwd=root,check=True,capture_output=True)
            self.assertEqual(before,(out/'albedo.png').read_bytes())
            self.assertTrue((root/'preview/review.png').exists())

    def test_invalid_parameters_are_rejected(self):
        for params in ({'seed':-1},{'size':4096},{'roughness':float('nan')},{'tileMetres':0},{'color':'oops'},{'recipe':'lava'}):
            with self.assertRaises(ValueError):build_material(params)

    def test_roughness_changes_preview_without_baking_into_albedo(self):
        with tempfile.TemporaryDirectory() as temporary:
            smooth=check({'size':64,'recipe':'painted_metal','roughness':.2})
            rough={**smooth,'roughness':.9}
            first=pathlib.Path(temporary)/'smooth'; second=pathlib.Path(temporary)/'rough'
            save(build_material(smooth),smooth,first); save(build_material(rough),rough,second)
            self.assertEqual((first/'albedo.png').read_bytes(),(second/'albedo.png').read_bytes())
            self.assertNotEqual((first/'review.png').read_bytes(),(second/'review.png').read_bytes())


if __name__=='__main__':unittest.main()
