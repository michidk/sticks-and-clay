"""Run inside Blender; checks shape topology, seeded variation and static LOD semantics."""
import json
import pathlib
import sys
import tempfile
import unittest
import bpy
import bmesh
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import assetkit as kit
from assetkit.lods import export_lods
from assetkit.readiness import inspect_asset
from assetkit.sprites import sample_frames


class ShapeTests(unittest.TestCase):
    def setUp(self):bpy.ops.wm.read_factory_settings(use_empty=True)

    def test_placement_and_copies_preserve_child_pivots(self):
        group=kit.root('Assembly')
        body=kit.rounded_box('Body',size=(2,2,2),location=(3,0,4),owner=group,radius=0)
        socket=kit.socket('socket_grip',(3,0,5),body)
        kit.slot(body,'grip',socket.name,['tool'])
        kit.sit_on_ground(group)
        bpy.context.view_layer.update()
        self.assertAlmostEqual(body.matrix_world.translation.z,1)
        self.assertAlmostEqual(body.children[0].matrix_world.translation.z,2)
        support=kit.rounded_box('Support',size=(4,4,2),radius=0)
        kit.place_on(group,support,gap=.25)
        bpy.context.view_layer.update()
        self.assertAlmostEqual(body.matrix_world.translation.x,0)
        self.assertAlmostEqual(body.matrix_world.translation.z,2.25)
        group.location.x=3
        copies=kit.circle_array(group,4)
        mirrored=kit.mirror_copy(group)
        bpy.context.view_layer.update()
        self.assertEqual(len(copies),4)
        self.assertEqual(len(mirrored.children_recursive),2)
        self.assertAlmostEqual(mirrored.matrix_world.translation.x,-group.matrix_world.translation.x)
        self.assertAlmostEqual(copies[1].matrix_world.translation.y,3)
        self.assertIsNot(copies[1].children[0].data,body.data)
        self.assertFalse(any(f['code']=='slot_socket' for f in kit.check(mirrored)['findings']))
        with self.assertRaises(ValueError):kit.place_on(group,body)
        with self.assertRaises(ValueError):kit.circle_array(group,0)

    def test_spatial_warnings_use_evaluated_geometry_and_explicit_contact_intent(self):
        a=kit.rounded_box('A',radius=0)
        b=kit.rounded_box('B',location=(.4,0,.2),radius=0)
        report=kit.check()
        self.assertTrue(any(f['code']=='CLIPPING' for f in report['spatial']['findings']))
        kit.allow_overlap(a,b,'Welded structural joint')
        self.assertFalse(any(f['code']=='CLIPPING' for f in kit.check()['spatial']['findings']))
        b.location.z=3
        kit.contact(b,a);kit.ground_contact(b)
        findings=kit.check()['spatial']['findings']
        self.assertTrue({'GAP','FLOATING'} <= {f['code'] for f in findings})
        kit.sit_on_ground(b)
        self.assertFalse(any(f['code']=='FLOATING' for f in kit.check()['spatial']['findings']))

    def test_readiness_requires_real_sockets_and_valid_declarations(self):
        owner=kit.rounded_box('Owner')
        target=kit.rounded_box('NotASocket')
        kit.slot(owner,'grip',target.name,['tool'])
        owner['event_hit']=json.dumps({'frame':1,'socket':target.name})
        orphan=bpy.data.objects.new('socket_orphan',None)
        bpy.context.collection.objects.link(orphan);orphan['asset_socket']=True
        report=inspect_asset([owner,target,orphan],[1,1,1])
        self.assertTrue({'slot_socket','event_socket','socket_parent'} <= {f['code'] for f in report['findings']})
        with self.assertRaises(ValueError):kit.open_surface(owner,'   ')
        for cells in [(1,2),(1,2,3,4)]:
            with self.assertRaises(ValueError):kit.grid_piece(owner,cells)
        kit.grid_piece(owner,(1,1,1))

    def test_developed_shapes_are_closed_and_rocks_are_seeded(self):
        [kit.extrude('Profile',[(0,0),(1,0),(1,.5),(.5,1),(0,.5)],.2),
                kit.lathe('Vessel',[(.3,0),(.5,.4),(.2,.8)]),
                kit.tube('Branch',[(0,0,0),(.2,0,.5),(.4,.2,1)],[.15,.1,.03]),
                kit.tree('Tree',height=2,seed=5)]
        for obj in bpy.context.scene.objects:
            if obj.type!='MESH':continue
            bm=bmesh.new();bm.from_mesh(obj.data)
            self.assertTrue(all(e.is_manifold for e in bm.edges),obj.name)
            self.assertTrue(all(f.calc_area()>1e-9 for f in bm.faces),obj.name)
            bm.free()
        a,b=kit.rock('RockA',seed=4),kit.rock('RockB',seed=4)
        self.assertEqual([tuple(v.co) for v in a.data.vertices],[tuple(v.co) for v in b.data.vertices])

    def test_lod_preserves_named_socket_and_original_geometry(self):
        group=kit.root('Prop');body=kit.rock('Body',owner=group)
        socket=kit.socket('socket_grip',(0,-.4,.2),body)
        parts=[group,body,socket]
        count=len(body.data.vertices)
        with tempfile.TemporaryDirectory() as directory:
            result=export_lods(parts,directory,[.5])
            bytes=(pathlib.Path(directory)/result[0]['file']).read_bytes()
            document=json.loads(bytes[20:20+int.from_bytes(bytes[12:16],'little')])
            self.assertIn('socket_grip',[n['name'] for n in document['nodes']])
        self.assertEqual(body.name,'Body');self.assertEqual(len(body.data.vertices),count)

    def test_examples_build_valid_starting_geometry(self):
        for script in (pathlib.Path(__file__).parent/'examples').glob('*.py'):
            bpy.ops.wm.read_factory_settings(use_empty=True)
            exec(compile(script.read_text(),'example.py','exec'),{'PARAMS':{'seed':7},'finish_asset':lambda **options:None})
            bpy.context.view_layer.update()
            parts=list(bpy.context.scene.objects)
            self.assertTrue(any(o.type=='MESH' for o in parts),script.name)
            self.assertEqual(inspect_asset(parts,[1,1,1])['findings'],[],script.name)

    def test_imported_sprite_frames_follow_actual_glb_animation_times(self):
        body=kit.rounded_box('MovingPart')
        body.location.x=0;body.keyframe_insert(data_path='location',frame=10)
        body.location.x=1;body.keyframe_insert(data_path='location',frame=20)
        kit.clip('Move',10,20)
        with tempfile.TemporaryDirectory() as directory:
            path=str(pathlib.Path(directory)/'animated.glb')
            bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',export_animations=True)
            bytes=pathlib.Path(path).read_bytes()
            doc=json.loads(bytes[20:20+int.from_bytes(bytes[12:16],'little')])
            inputs=[doc['accessors'][s['input']] for s in doc['animations'][0]['samplers']]
            expected=[round(min(a['min'][0] for a in inputs)*24),round(max(a['max'][0] for a in inputs)*24)]
            bpy.ops.wm.read_factory_settings(use_empty=True)
            bpy.ops.import_scene.gltf(filepath=path)
            frames=sample_frames(bpy.context.scene)
            self.assertEqual([frames[0],frames[-1]],expected)


if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(ShapeTests)
    result=unittest.TextTestRunner().run(suite)
    if not result.wasSuccessful():raise RuntimeError('Assetkit shape tests failed')
