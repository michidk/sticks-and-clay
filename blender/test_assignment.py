"""Run inside Blender; check actual GLB bindings and original preservation."""
import hashlib
import json
import pathlib
import runpy
import shutil
import tempfile
import unittest
import bpy

class AssignmentTests(unittest.TestCase):
    def test_derived_glb_embeds_maps_and_preserves_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);(root/'maps').mkdir()
            bpy.ops.wm.read_factory_settings(use_empty=True)
            bpy.ops.mesh.primitive_cube_add()
            obj=bpy.context.object
            material=bpy.data.materials.new('Surface');material.use_nodes=True
            obj.data.materials.append(material)
            for name,color in [('albedo',(.2,.4,.1,1)),('normal',(.5,.5,1,1)),('roughness',(.7,.7,.7,1)),('metallic',(0,0,0,1)),('ao',(.8,.8,.8,1))]:
                image=bpy.data.images.new(name,4,4);image.generated_color=color
                image.filepath_raw=str(root/'maps'/f'{name}.png');image.file_format='PNG';image.save()
                if name=='albedo':
                    texture=material.node_tree.nodes.new('ShaderNodeTexImage');texture.image=image
                    material.node_tree.links.new(texture.outputs['Color'],material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
            bpy.ops.export_scene.gltf(filepath=str(root/'source.glb'),export_format='GLB')
            before=(root/'source.glb').read_bytes()
            (root/'params.json').write_text(json.dumps({'slot':'Surface','repeat':2,'materialVersionId':'fixture'}))
            shutil.copyfile(pathlib.Path(__file__).parent/'assign_material.py',root/'assign_material.py')
            shutil.copyfile(pathlib.Path(__file__).parent/'build_artifacts.py',root/'build_artifacts.py')
            runpy.run_path(str(root/'assign_material.py'))
            self.assertEqual((root/'source.glb').read_bytes(),before)
            result=(root/'derived.glb').read_bytes();doc=json.loads(result[20:20+int.from_bytes(result[12:16],'little')])
            mat=next(m for m in doc['materials'] if m['name']=='Assigned PBR')
            self.assertIn('normalTexture',mat)
            self.assertIn('occlusionTexture',mat)
            self.assertIn('metallicRoughnessTexture',mat['pbrMetallicRoughness'])
            transform=mat['pbrMetallicRoughness']['baseColorTexture']['extensions']['KHR_texture_transform']
            self.assertEqual(transform['scale'],[2,2])
            self.assertEqual(json.loads((root/'assignment.json').read_text())['sourceSha256'],hashlib.sha256(before).hexdigest())

if __name__=='__main__':
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(AssignmentTests))
    if not result.wasSuccessful():raise RuntimeError('Assignment regression')
