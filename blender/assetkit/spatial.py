"""Bounded cross-object surface checks. Contact warnings are evidence, not collision proof."""
import bpy
import math
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def inspect_spatial(parts, max_pairs=4096, max_triangles=500000):
    bpy.context.view_layer.update()
    depsgraph=bpy.context.evaluated_depsgraph_get()
    records=[];findings=[];skipped=[];triangles=0
    for obj in parts:
        if obj.type!='MESH':continue
        evaluated=obj.evaluated_get(depsgraph)
        mesh=evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            triangles+=len(mesh.loop_triangles)
            if triangles>max_triangles:
                skipped.append(obj.name);continue
            vertices=[obj.matrix_world @ v.co for v in mesh.vertices]
            if not vertices:continue
            low=Vector([min(v[i] for v in vertices) for i in range(3)])
            high=Vector([max(v[i] for v in vertices) for i in range(3)])
            tree=BVHTree.FromPolygons(vertices,[tuple(t.vertices) for t in mesh.loop_triangles],all_triangles=True)
            records.append((obj,low,high,tree))
        finally:evaluated.to_mesh_clear()
    by_name={obj.name:(low,high) for obj,low,high,_ in records}
    for obj,low,high,_ in records:
        if 'ground_contact_z' in obj:
            gap=low.z-obj['ground_contact_z']
            if abs(gap)>obj.get('ground_contact_tolerance',.002):
                findings.append({'code':'FLOATING' if gap>0 else 'GROUND_PENETRATION','objects':[obj.name],
                                 'severity':'warning','gapMetres':gap,'message':'Declared ground contact does not meet the ground plane.'})
        for key in obj.keys():
            if not key.startswith('contact_'):continue
            target=key[len('contact_'):]
            if target not in by_name:
                findings.append({'code':'CONTACT_UNCHECKED','objects':[obj.name,target],'severity':'warning',
                                 'message':'Declared support is missing or exceeded the spatial check budget.'})
                continue
            bottom,top=by_name[target]
            gap=math.sqrt(sum(max(0,bottom[i]-high[i],low[i]-top[i])**2 for i in range(3)))
            if gap>obj[key]:findings.append({'code':'GAP','objects':[obj.name,target],'gapMetres':gap,'severity':'warning',
                                           'message':'World bounds are separated beyond the declared contact tolerance.'})
    tested=0;truncated=False
    for index,(a,low,high,tree) in enumerate(records):
        for b,bottom,top,other in records[index+1:]:
            if a.get('allowed_overlap_'+b.name) or b.get('allowed_overlap_'+a.name):continue
            if any(high[i]<bottom[i] or top[i]<low[i] for i in range(3)):continue
            if tested>=max_pairs:truncated=True;continue
            tested+=1
            if tree.overlap(other):
                findings.append({'code':'CLIPPING','objects':[a.name,b.name],'severity':'warning',
                                 'message':'Evaluated mesh surfaces intersect or touch; inspect the join and fix unintended penetration or declare intentional overlap with a reason.'})
    return {'findings':findings,'testedPairs':tested,'skippedObjects':skipped,'pairLimitReached':truncated,
            'limitations':['Surface intersections include intentional touching and coplanar faces.',
                           'Contact gaps use bounds: separated bounds prove a gap; overlapping bounds do not prove contact.',
                           'Enclosed objects without intersecting surfaces are not detected; this is not a solid-volume collision test.',
                           'Checks describe the current pose only; no swept motion or physical support proof.']}
