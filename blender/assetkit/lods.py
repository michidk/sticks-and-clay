"""Requested static LOD copies. Never alter source geometry."""
import json
import os
import bpy


def export_lods(parts,directory,ratios):
    if len(ratios)>3 or any(not 0<r<1 for r in ratios):raise ValueError('Use up to three ratios between zero and one')
    if any(o.type=='ARMATURE' or o.animation_data or (o.type=='MESH' and o.data.shape_keys) for o in parts):raise ValueError('Automatic LODs support static geometry only')
    result=[]
    for index,ratio in enumerate(ratios,1):
        copies={}
        names={obj:obj.name for obj in parts}
        try:
            for obj in parts:obj.name=names[obj]+'.source'
            for obj in parts:
                clone=obj.copy()
                clone.name=names[obj]
                if obj.type=='MESH':clone.data=obj.data.copy()
                bpy.context.collection.objects.link(clone)
                copies[obj]=clone
            for original,clone in copies.items():
                clone.parent=copies.get(original.parent)
                clone.matrix_parent_inverse=original.matrix_parent_inverse.copy()
                clone.matrix_basis=original.matrix_basis.copy()
                if clone.type=='MESH':clone.modifiers.new('Requested LOD','DECIMATE').ratio=ratio
            bpy.ops.object.select_all(action='DESELECT')
            for clone in copies.values():clone.select_set(True)
            file=f'asset-lod-{index}.glb'
            bpy.ops.export_scene.gltf(filepath=os.path.join(directory,file),export_format='GLB',use_selection=True,export_apply=True,export_extras=True)
            result.append({'file':file,'ratio':ratio})
        finally:
            for clone in copies.values():
                data=clone.data if clone.type=='MESH' else None
                bpy.data.objects.remove(clone,do_unlink=True)
                if data and data.users==0:bpy.data.meshes.remove(data)
            for obj in parts:obj.name=names[obj]
    with open(os.path.join(directory,'lods.json'),'w') as file:json.dump(result,file)
    return result
