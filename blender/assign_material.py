"""Bind a pinned PBR set to an explicit slot; preserve the source GLB."""
import hashlib
import json
import pathlib
import sys
import uuid
import shutil
import bpy

root = pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(root))
from build_artifacts import receipt, publish_workspace
params = json.loads((root / 'params.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'source.glb'))
material = bpy.data.materials.new('Assigned PBR')
material.use_nodes = True
nodes, links = material.node_tree.nodes, material.node_tree.links
shader = nodes.get('Principled BSDF')
texcoord = nodes.new('ShaderNodeTexCoord')
mapping = nodes.new('ShaderNodeMapping'); mapping.vector_type = 'POINT'
mapping.inputs['Scale'].default_value = (params['repeat'],params['repeat'],1)
links.new(texcoord.outputs['UV'], mapping.inputs[0])
for name, socket in [('albedo', 'Base Color'), ('roughness', 'Roughness'), ('metallic', 'Metallic'), ('normal', None)]:
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = bpy.data.images.load(str(root / 'maps' / (name + '.png')))
    texture.image.colorspace_settings.name = 'sRGB' if name == 'albedo' else 'Non-Color'
    links.new(mapping.outputs[0], texture.inputs['Vector'])
    if socket: links.new(texture.outputs['Color'], shader.inputs[socket])
    else:
        normal = nodes.new('ShaderNodeNormalMap')
        links.new(texture.outputs['Color'], normal.inputs['Color'])
        links.new(normal.outputs['Normal'], shader.inputs['Normal'])
occlusion=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree')
occlusion.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
group=nodes.new('ShaderNodeGroup');group.node_tree=occlusion
texture=nodes.new('ShaderNodeTexImage');texture.image=bpy.data.images.load(str(root/'maps/ao.png'))
texture.image.colorspace_settings.name='Non-Color'
links.new(mapping.outputs[0],texture.inputs['Vector']);links.new(texture.outputs['Color'],group.inputs['Occlusion'])
assigned = 0
for obj in bpy.context.scene.objects:
    if obj.type != 'MESH': continue
    for slot in obj.material_slots:
        if slot.material and slot.material.name == params['slot']:
            if not obj.data.uv_layers: raise ValueError('Selected mesh has no UV coordinates: ' + obj.name)
            slot.material = material; assigned += 1
if not assigned: raise ValueError('Selected material slot is absent from the source model')
candidate = root / ('.candidate-'+uuid.uuid4().hex);candidate.mkdir()
bpy.ops.export_scene.gltf(filepath=str(candidate/'derived.glb'), export_format='GLB')
(candidate / 'assignment.json').write_text(json.dumps({
    'version': 1, 'sourceSha256': hashlib.sha256((root / 'source.glb').read_bytes()).hexdigest(),
    'parameters': params, 'assignedSlots': assigned, 'blender': bpy.app.version_string,
    'conventions': 'sRGB albedo; linear data; OpenGL normal. Height remains a separate map.'
}, indent=2))
receipt(candidate,'model','final',hashlib.sha256((root/'source.glb').read_bytes()+(root/'params.json').read_bytes()).hexdigest(),{'blender':bpy.app.version_string,'runner':'3'})
publish_workspace(candidate,root,['derived.glb','assignment.json','build-receipt.json'])
shutil.rmtree(candidate)
