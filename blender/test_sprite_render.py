"""Run inside Blender: actual animated GLB -> shared-palette sprite frames."""
import hashlib
import json
import pathlib
import sys
import tempfile
import unittest
import bpy
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from sprite_render import render
from assetkit.pixel import process, rgb, oklab, cell_checks


class SpriteTests(unittest.TestCase):
    def test_render_imported_animation_and_preserve_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            bpy.ops.wm.read_factory_settings(use_empty=True)
            bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,.5))
            obj=bpy.context.object; obj.name='Animated prop'
            material=bpy.data.materials.new('Clay'); material.diffuse_color=(.3,.6,.2,1)
            obj.data.materials.append(material)
            obj.keyframe_insert(data_path='location',frame=1)
            obj.location.z=.7; obj.keyframe_insert(data_path='location',frame=5)
            bpy.context.scene.frame_start=1; bpy.context.scene.frame_end=5
            bpy.ops.export_scene.gltf(filepath=str(root/'source.glb'),export_format='GLB',export_animations=True)
            before=(root/'source.glb').read_bytes()
            (root/'params.json').write_text(json.dumps({'clip':'@animation:0','pixel':True,'size':32,'directions':1,'frameCount':2,'fps':8,'colors':4,'outline':'#102030'}))
            render(root)
            self.assertEqual(before,(root/'source.glb').read_bytes())
            receipt=json.loads((root/'output/receipt.json').read_text())
            self.assertEqual(receipt['sourceSha256'],hashlib.sha256(before).hexdigest())
            doc=json.loads((root/'output/sprites.json').read_text())
            self.assertEqual(doc['fps'],8); self.assertEqual(len(doc['cells']),2)
            self.assertLess(doc['cells'][0]['frame'],doc['cells'][1]['frame'])
            self.assertEqual(doc['lighting'],'camera-relative'); self.assertEqual(doc['supersample'],4)
            image=bpy.data.images.load(str(root/'output/sprites.png'))
            self.assertEqual(tuple(image.size),(32,64))
            values=np.asarray(image.pixels[:]).reshape(64,32,4)
            self.assertTrue(set(np.unique(values[:,:,3])).issubset({0.,1.}))
            colors=np.unique(values[:,:,:3][values[:,:,3]>.5],axis=0)
            self.assertLessEqual(len(colors),4)
            self.assertTrue((root/'output/review-silhouette-f0-d0.png').exists())
            self.assertTrue(all((root/'output'/cell['file']).exists() for cell in doc['cells']))
            from assetkit.timeline import sample_frames
            loop=sample_frames(bpy.context.scene,4,True)
            once=sample_frames(bpy.context.scene,4,False)
            self.assertLess(loop[-1],once[-1])
            self.assertEqual(len(set(loop)),4)
            self.assertTrue(np.any(values[:,:,3]>0)); self.assertTrue(np.any(values[:,:,3]==0))
            # A looping sample never repeats its first pose at the end.
            self.assertNotIn(loop[0]+(once[-1]-once[0]),loop)
            # Every cell shares one ground pivot; engines get it with point filtering and bottom-left rects.
            self.assertEqual(len({tuple(c['pivot']) for c in doc['cells']}),1)
            self.assertEqual(doc['baselinePx'],int(np.floor(doc['pivot'][1])))
            unity=json.loads((root/'output/sprites.unity.json').read_text())
            self.assertEqual(unity['textureImporter']['filterMode'],'Point')
            self.assertEqual(unity['sprites'][0]['rect'],{'x':0,'y':32,'width':32,'height':32})
            self.assertEqual(unity['clips'][0]['sprites'],['d0_f00','d0_f01'])
            godot=json.loads((root/'output/sprites.godot.json').read_text())
            self.assertEqual(godot['animations'][0]['frames'][1]['region'],[0,32,32,32])
            checks=json.loads((root/'output/sprite-checks.json').read_text())
            self.assertEqual(len(checks['cells']),2)
            self.assertIn('valueRange',checks['cells'][0]); self.assertEqual(checks['cells'][0]['pixelScale'],1)
            self.assertEqual(checks['baselines'][0]['direction'],0)

    def test_outline_is_cell_local_and_palette_is_shared(self):
        sheet=np.zeros((4,8,4),np.float32)
        sheet[1:3,2:4]=(.2,.4,.2,1); sheet[1:3,6:8]=(.2,.4,.2,1)
        result=process(sheet,4,colors=2,palette=['#102030','#70aa80'],outline='#102030')
        self.assertTrue(np.all(result[:,4,:]==0))
        np.testing.assert_array_equal(result[1,2,:3],result[1,6,:3])

    def test_auto_outline_stays_on_palette_and_counts_in_the_budget(self):
        sheet=np.zeros((8,8,4),np.float32)
        sheet[2:6,2:6]=(.6,.3,.1,1); sheet[2:4,2:6]=(.1,.5,.8,1); sheet[5,2:6]=(.05,.05,.02,1)
        palette=['#204060','#e0a040','#30a0d0','#101418']
        result=process(sheet,8,colors=4,palette=palette,outline='auto')
        allowed={tuple(np.round(rgb(c),5)) for c in palette}
        used={tuple(np.round(c,5)) for c in result[:,:,:3][result[:,:,3]>.5]}
        self.assertTrue(used<=allowed)
        np.testing.assert_allclose(result[1,3,:3],rgb('#101418'),atol=1e-6)  # the palette's darkest
        free=process(sheet,8,colors=3,outline='auto')
        colors=np.unique(free[:,:,:3][free[:,:,3]>.5],axis=0)
        self.assertLessEqual(len(colors),3)
        ink=free[1,3,:3]
        self.assertLess(oklab(ink)[0],min(oklab(c)[0] for c in colors if not np.allclose(c,ink)))

    def test_quantisation_separates_hues_in_oklab(self):
        # Two dark hues of equal brightness and a light one: OKLab keeps the hues apart with 3 colors.
        sheet=np.zeros((6,6,4),np.float32)
        sheet[:2]=(.20,.02,.02,1); sheet[2:4]=(.02,.02,.20,1); sheet[4:]=(.8,.8,.7,1)
        sheet[0,0]=(.21,.02,.02,1); sheet[2,0]=(.02,.02,.21,1)
        result=process(sheet,6,colors=3)
        self.assertEqual(len(np.unique(result[:,:,:3].reshape(-1,3),axis=0)),3)
        self.assertGreater(result[0,1,0],result[0,1,2]); self.assertGreater(result[2,1,2],result[2,1,0])

    def test_cell_checks_flag_upscaled_cells_and_flat_values(self):
        cell=np.zeros((16,16,4),np.float32)
        for y in range(16):
            for x in range(16):
                cell[y,x]=((.1,.1,.1,1),(.9,.9,.9,1),(.5,.2,.1,1))[((x//2)+2*(y//2))%3]
        measured,warnings=cell_checks(cell)
        self.assertEqual(measured['pixelScale'],2); self.assertTrue(any('2x2 block' in w for w in warnings))
        flat=np.zeros((16,16,4),np.float32); flat[4:12,4:12]=(.4,.4,.4,1); flat[4:12,8:12]=(.42,.42,.42,1)
        measured,warnings=cell_checks(flat)
        self.assertLess(measured['valueRange'],.35); self.assertTrue(any('value range' in w for w in warnings))
        self.assertEqual(measured['feetRow'],11)


if __name__=='__main__':unittest.main(argv=[sys.argv[0]])
