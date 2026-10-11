"""Real Blender smoke test: draft/final failure isolation, hierarchy, rebuild, sprites."""
import asyncio
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest
import sys
import zipfile
import hashlib
from PIL import Image
from blender import server

CODE = '''import assetkit as kit
group=kit.root("TestProp")
mat=kit.color_material("Clay",(.3,.4,.2,1))
body=kit.rounded_box("Body",(1,1,1),(0,0,.5),material=mat,owner=group)
hinge=kit.rounded_box("Hinge",(.2,.2,.4),(.6,0,.5),material=mat,owner=group)
kit.pivot(hinge,(.5,0,.3))
kit.socket("socket_grip",(.5,-.2,.4),hinge)
kit.grid_piece(body,(1,1,1))
kit.collider(body,"box")
kit.allow_overlap(body,hinge,"seated hinge")
hinge.rotation_euler.z=0
hinge.keyframe_insert(data_path="rotation_euler",frame=1)
hinge.rotation_euler.z=.5
hinge.keyframe_insert(data_path="rotation_euler",frame=2)
kit.clip("Open",1,2)
finish_asset(material_mode="poly",sprites={"directions":2,"frames":[1,2],"size":32})
'''

@unittest.skipUnless(os.environ.get('BLENDER_BIN'), 'Set BLENDER_BIN for offline Blender smoke test')
class WorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_draft_final_failure_and_rebuild(self):
        previous=server.DATA
        with tempfile.TemporaryDirectory() as directory:
            server.DATA=pathlib.Path(directory)
            cap='12345678-1234-1234-1234-123456789abc'
            (server.DATA/'capabilities').mkdir()
            baseline=server.DATA/'baseline/shape.json'
            baseline.parent.mkdir()
            baseline.write_text(json.dumps({'width':1}))
            code=f"import json, random\nimport numpy as np\nwidth=json.load(open({baseline.as_posix()!r}))['width'] * (1 + random.random() * .1 + np.random.random() * .1)\n"+CODE.replace('"Body",(1,1,1)', '"Body",(width,1,1)')
            (server.DATA/'capabilities'/f'{cap}.json').write_text(json.dumps({'directory':'model','role':'builder','seed':17,'inputs':['baseline/shape.json']}))
            try:
                await server.asset_workspace({'capability':cap,'operation':'write','code':code})
                draft=await server.asset_workspace({'capability':cap,'operation':'run','mode':'quick'})
                self.assertTrue(draft['ok'],draft['log'])
                dest=server.DATA/'model'
                self.assertTrue((dest/'preview/front.png').exists())
                self.assertTrue((dest/'preview/sprites.png').exists())
                self.assertFalse((dest/'sprites.png').exists())
                self.assertFalse((dest/'asset.glb').exists())
                final=await server.asset_workspace({'capability':cap,'operation':'run','mode':'final'})
                self.assertTrue(final['ok'],final['log'])
                self.assertEqual(final['scriptSha256'],hashlib.sha256((dest/'asset.py').read_bytes()).hexdigest())
                self.assertEqual(json.loads((dest/'params.json').read_text()),{'seed':17})
                original=(dest/'asset.glb').read_bytes()
                doc=json.loads(original[20:20+int.from_bytes(original[12:16],'little')])
                nodes={n['name']:n for n in doc['nodes']}
                self.assertIn('socket_grip',nodes)
                self.assertTrue(nodes['Hinge'].get('children'))
                self.assertTrue(doc.get('animations'))
                self.assertEqual(final['metrics']['readiness']['clips']['Open']['end'],2)
                layout=json.loads((dest/'sprites.json').read_text())
                self.assertEqual(len(layout['cells']),4)
                with Image.open(dest/'sprites.png') as sheet:
                    self.assertEqual(sheet.size,(64,64))
                    self.assertIn('A',sheet.getbands())
                    self.assertEqual(sheet.getchannel('A').getextrema(),(0,255))
                # Freeze the successful version before a later failed edit.
                package=server.DATA/'source.zip'
                with zipfile.ZipFile(package,'w') as bundle:
                    for path in dest.rglob('*'):
                        if path.is_file() and not any(p in ['build-support','preview','script-revisions','__pycache__'] for p in path.relative_to(dest).parts):
                            bundle.write(path,path.relative_to(dest).as_posix())
                failure=await server.execute_blender_code(cap,'raise RuntimeError("intentional failure")')
                self.assertFalse(failure['ok'])
                self.assertEqual(original,(dest/'asset.glb').read_bytes())
                self.assertFalse(json.loads((dest/'build-state.json').read_text())['ok'])
                baseline.write_text(json.dumps({'width':99}))
                other=server.DATA/'relocated'
                with zipfile.ZipFile(package) as bundle:bundle.extractall(other)
                proc=await asyncio.create_subprocess_exec(sys.executable,str(other/'render.py'),'--mode','final','--blender',os.environ['BLENDER_BIN'],stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
                output,_=await proc.communicate()
                self.assertEqual(proc.returncode,0,output.decode()[-2000:])
                rebuilt=json.loads((other/'metrics.json').read_text())
                self.assertEqual(rebuilt['dimensions'],final['metrics']['dimensions'])
                self.assertEqual(rebuilt['triangles'],final['metrics']['triangles'])
            finally:server.DATA=previous

if __name__=='__main__':unittest.main()
