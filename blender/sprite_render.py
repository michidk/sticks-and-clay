"""Blender-side sprite export. The source GLB is read without modification."""
import hashlib
import json
import pathlib
import sys
import math
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
import bpy
from mathutils import Vector
from assetkit.sprites import render_sheet, sample_frames
from assetkit.timeline import select_clip
from build_artifacts import receipt, publish
import uuid


def render(root):
    root=pathlib.Path(root).resolve()
    options=json.loads((root/'params.json').read_text(encoding='utf-8'))
    source=root/'source.glb'
    digest=hashlib.sha256(source.read_bytes()).hexdigest()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    scene=bpy.context.scene
    scene.render.engine='CYCLES'; scene.cycles.samples=8
    scene.world=bpy.data.worlds.new('Sprite world'); scene.world.use_nodes=True
    scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.35
    raw=source.read_bytes()
    document=json.loads(raw[20:20+int.from_bytes(raw[12:16],'little')])
    select_clip(scene,options.get('clip',''),document)
    frames=sample_frames(scene,options.get('frameCount',1),options.get('loop',False))
    meshes=[o for o in scene.objects if o.type=='MESH']
    points=[]
    for frame in frames:
        scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame)); deps=bpy.context.evaluated_depsgraph_get()
        for obj in meshes:
            evaluated=obj.evaluated_get(deps)
            points.extend(evaluated.matrix_world@Vector(c) for c in evaluated.bound_box)
    if not points:raise ValueError('Source has no mesh geometry')
    lo=Vector([min(p[i] for p in points) for i in range(3)])
    hi=Vector([max(p[i] for p in points) for i in range(3)])
    center=(lo+hi)/2
    span=max((p-center).length for p in points)*2
    if span<=0:raise ValueError('Source has empty bounds')
    for index,(pos,energy) in enumerate([((2,-3,4),1100),((-3,-1,2),850),((0,3,3),1000)]):
        data=bpy.data.lights.new('Sprite light '+str(index),'AREA'); data.energy=energy*span*span; data.size=span*2
        light=bpy.data.objects.new(data.name,data); scene.collection.objects.link(light)
        light.location=center+Vector(pos)*span
        light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Sprite camera'); camera=bpy.data.objects.new(data.name,data)
    scene.collection.objects.link(camera); scene.camera=camera
    data.clip_start=max(span*.001,.001); data.clip_end=max(span*100,100)
    scene.frame_start=math.floor(min(frames)); scene.frame_end=math.ceil(max(frames))
    options['anchorPoint']=list(Vector((center.x,center.y,lo.z)) if options.get('anchor','ground')=='ground' else center)
    options['frames']=frames
    out=root/('.candidate-'+uuid.uuid4().hex); out.mkdir()
    render_sheet(scene,camera,center,span,str(out),options)
    if hashlib.sha256(source.read_bytes()).hexdigest()!=digest:raise ValueError('Source changed')
    (out/'receipt.json').write_text(json.dumps({'sourceSha256':digest,'frames':frames,'blender':bpy.app.version_string}),encoding='utf-8')
    receipt(out,'sprite','final',hashlib.sha256(source.read_bytes()+(root/'params.json').read_bytes()).hexdigest(),{'blender':bpy.app.version_string,'runner':'3'})
    publish(out,root/'output')


if __name__=='__main__':render(pathlib.Path(__file__).parent)
