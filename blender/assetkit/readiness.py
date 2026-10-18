"""Intent-aware source checks. Advisory evidence, not an artistic quality score."""
import json
import math
import bpy
import bmesh
from .spatial import inspect_spatial


def inspect_asset(parts, dimensions):
    findings = []
    nodes = []
    sockets = {p.name for p in parts if p.get('asset_socket')}
    def issue(code,obj,message):
        findings.append({"code":code,"object":obj.name,"message":message,"severity":"warning"})
    for obj in parts:
        record={"name":obj.name,"type":obj.type,"parent":obj.parent.name if obj.parent else None,
                "pivot":list(obj.matrix_world.translation),"extras":{k:(obj[k].to_list() if hasattr(obj[k],'to_list') else obj[k]) for k in obj.keys() if k!='_RNA_UI'}}
        nodes.append(record)
        if not all(math.isfinite(v) for row in obj.matrix_world for v in row):
            issue("transform",obj,"Non-finite transform")
        if obj.type=='MESH':
            bm=bmesh.new()
            bm.from_mesh(obj.data)
            boundary=sum(e.is_boundary for e in bm.edges)
            nonmanifold=sum(not e.is_manifold and not e.is_boundary for e in bm.edges)
            degenerate=sum(f.calc_area()<1e-10 for f in bm.faces)
            if degenerate:issue('degenerate_faces',obj,f'{degenerate} zero-area faces')
            if boundary and not obj.get('open_surface_reason'):
                issue("open_edges",obj,f"{boundary} open edges; repair or declare an intentional open surface")
            if nonmanifold:
                issue("nonmanifold",obj,f"{nonmanifold} non-manifold edges")
            bm.free()
            if any(m and m.use_nodes and any(n.type=='TEX_IMAGE' for n in m.node_tree.nodes) for m in obj.data.materials) and not obj.data.uv_layers:
                issue("uv_missing",obj,"Image material has no UV layer")
            if obj.get('grid_cells'):
                wanted=[c*obj['grid_size'] for c in obj['grid_cells']]
                if any(w>0 and abs(a-w)>max(.001,w*.001) for a,w in zip(obj.dimensions,wanted)):
                    issue("grid_fit",obj,f"Dimensions {list(obj.dimensions)} do not fit declared cells {wanted}")
        if obj.get('asset_socket') and obj.parent is None:
            issue("socket_parent",obj,"Socket needs an owning part")
        for key in obj.keys():
            if key.startswith('slot_'):
                slot=json.loads(obj[key])
                if slot['socket'] not in sockets:
                    issue("slot_socket",obj,f"Missing socket {slot['socket']}")
            if key.startswith('event_'):
                event=json.loads(obj[key])
                if not bpy.context.scene.frame_start <= event['frame'] <= bpy.context.scene.frame_end:
                    issue("event_frame",obj,f"Event frame {event['frame']} is outside the animation range")
                if event.get('socket') and event['socket'] not in sockets:
                    issue("event_socket",obj,f"Missing event socket {event['socket']}")
    clips={k[5:]:json.loads(bpy.context.scene[k]) for k in bpy.context.scene.keys() if k.startswith('clip_')}
    spatial=inspect_spatial(parts)
    return {"version":2,"status":"warnings" if findings or spatial['findings'] else "passed","findings":findings,"spatial":spatial,
            "nodes":nodes,"clips":clips,"fps":bpy.context.scene.render.fps/bpy.context.scene.render.fps_base,"dimensions":dimensions,
            "limitations":["Source topology, current-pose surface intersections and declared interfaces only; exported GLB receives separate analysis.","No physical simulation proof."]}
