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
from assetkit.pixel import process


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

    def test_outline_is_cell_local_and_palette_is_shared(self):
        sheet=np.zeros((4,8,4),np.float32)
        sheet[1:3,2:4]=(.2,.4,.2,1); sheet[1:3,6:8]=(.2,.4,.2,1)
        result=process(sheet,4,colors=2,palette=['#102030','#70aa80'],outline='#102030')
        self.assertTrue(np.all(result[:,4,:]==0))
        np.testing.assert_array_equal(result[1,2,:3],result[1,6,:3])


if __name__=='__main__':unittest.main(argv=[sys.argv[0]])
