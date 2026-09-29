"""Advisory findings; exact-position topology, no mesh repair or file writes to source."""
import json, sys
import numpy as np
import trimesh

def analyze(objects):
    findings, unavailable = [], []
    def add(obj, code, count, faces=(), confidence='high'):
        if count:
            sample = [int(i) for i in list(faces)[:20]]
            findings.append(dict(object=obj['name'], code=code, count=int(count), confidence=confidence,
                triangles=sample, polygons=sorted({obj['polygons'][i] for i in sample})))
    try:
        from igl.copyleft.cgal import remesh_self_intersections
    except ImportError:
        remesh_self_intersections = None
        unavailable.append('self_intersections: libigl CGAL unavailable')
    for obj in objects:
        v, f = np.asarray(obj['vertices'], dtype=float), np.asarray(obj['faces'], dtype=np.int64)
        if not len(f):
            continue
        if not np.isfinite(v).all():
            add(obj, 'nonfinite_positions', 1)
            continue
        v, inverse = np.unique(v, axis=0, return_inverse=True)
        f = inverse[f]
        mesh = trimesh.Trimesh(v, f, process=False)
        scale = np.ptp(v, axis=0).max()
        deg = np.flatnonzero(mesh.area_faces <= max(scale**2 * 1e-14, 1e-30))
        add(obj, 'degenerate_triangles', len(deg), deg)
        _, first, counts = np.unique(np.sort(f, axis=1), axis=0, return_index=True, return_counts=True)
        dup = first[counts > 1]
        add(obj, 'duplicate_or_coincident_triangles', int(np.sum(counts - 1)), dup)
        for code, data in obj['topology'].items():
            add(obj, code, data['count'], data['faces'], 'medium' if code == 'open_boundary' else 'high')
        if not mesh.is_winding_consistent:
            adjacent = mesh.face_adjacency
            bad = []
            for a, b in adjacent:
                ea = {(int(f[a,i]), int(f[a,(i+1)%3])) for i in range(3)}
                eb = {(int(f[b,i]), int(f[b,(i+1)%3])) for i in range(3)}
                if ea & eb:
                    bad.extend([a,b])
            add(obj, 'inconsistent_winding', len(set(bad)), sorted(set(bad)))
        if mesh.is_watertight and mesh.is_winding_consistent and mesh.volume < -scale**3 * 1e-12:
            add(obj, 'inward_closed_shell', len(f), range(len(f)))
        components = trimesh.graph.connected_components(mesh.face_adjacency, nodes=np.arange(len(f)), min_len=1)
        areas = [mesh.area_faces[c].sum() for c in components]
        if areas and max(areas) > 0:
            tiny = [c for c,a in zip(components,areas) if 0 < a < max(areas)*1e-5 and len(c) <= 8]
            add(obj, 'tiny_disconnected_islands', len(tiny), [int(i) for c in tiny for i in c], 'medium')
        textured = np.asarray(obj['textured'], dtype=bool)
        if textured.any():
            if obj['uv'] is None:
                add(obj, 'textured_faces_missing_uv', int(textured.sum()), np.flatnonzero(textured))
            else:
                uv = np.asarray(obj['uv'])
                a, b = uv[:,1]-uv[:,0], uv[:,2]-uv[:,0]
                bad = textured & (~np.isfinite(uv).all(axis=(1,2)) | (np.abs(a[:,0]*b[:,1]-a[:,1]*b[:,0]) < 1e-14))
                add(obj, 'collapsed_or_nonfinite_uv', int(bad.sum()), np.flatnonzero(bad))
        if scale > 1e6 or scale < 1e-6:
            add(obj, 'extreme_extent_meters', 1, confidence='medium')
            findings[-1]['extentMeters'] = float(scale)
        # Detect only. Never use remeshed return values. Bound expensive analysis.
        if remesh_self_intersections and len(f) <= 100000 and not len(deg) and not len(dup):
            try:
                pairs = remesh_self_intersections(v, f, detect_only=True, first_only=True)[2]
                add(obj, 'self_intersections', len(pairs), np.unique(pairs), 'medium')
                if len(pairs):
                    findings[-1]['countIsLowerBound'] = True
            except Exception as e:
                unavailable.append(obj['name'] + ': self_intersections failed: ' + type(e).__name__)
        else:
            unavailable.append(obj['name'] + ': self_intersections skipped (backend, size or invalid triangles)')
    return {'version': 1, 'faceSpace': 'Blender imported loop triangles and polygon indices', 'findings': findings[:80],
            'truncated': len(findings) > 80, 'unavailable': unavailable,
            'limitations': ['No cross-object intersection or near-coplanar proximity test', 'Open boundaries and tiny islands may be intentional', 'No density budget, UV tiling/overlap or shading-normal heuristics']}

if __name__ == '__main__':
    with open(sys.argv[1]) as source:
        result = analyze(json.load(source))
    with open(sys.argv[2], 'w') as output:
        json.dump(result, output)
