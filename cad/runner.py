"""Offline CAD build: execute source, check solids, export exact CAD and tessellated previews."""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import platform
import tempfile
import traceback
import cadquery as cq
import numpy as np
import trimesh
from cadcore import check, execute, measure
from build_runtime import render_slot


def build(root, destination, blender, mode='final'):
    source = (root / 'asset.py').read_text(encoding='utf-8-sig')
    shapes = execute(source)
    metrics = measure(shapes)
    if (root / 'input.step').exists():
        baseline = measure([('input', cq.importers.importStep(str(root / 'input.step')).val())])
        metrics['sourceComparison'] = {'source': baseline,
                                      'dimensionDeltaMm': {axis: metrics['dimensionsMm'][axis] - baseline['dimensionsMm'][axis] for axis in 'xyz'},
                                      'volumeDeltaMm3': metrics['volumeMm3'] - baseline['volumeMm3']}
    spec = json.loads((root / 'spec.json').read_text(encoding='utf-8'))
    metrics['checks'] = check(metrics, spec.get('requirements', []))
    with tempfile.TemporaryDirectory(prefix='cad-candidate-', dir=root) as temporary:
        candidate = pathlib.Path(temporary)
        compound = cq.Compound.makeCompound([shape for _, shape in shapes])
        cq.exporters.export(compound, str(candidate / 'asset.step'))
        restored = cq.importers.importStep(str(candidate / 'asset.step')).val()
        if not restored.isValid() or len(restored.Solids()) != metrics['solidCount'] or abs(restored.Volume() - metrics['volumeMm3']) > max(1e-5, metrics['volumeMm3'] * 1e-7):
            raise ValueError('STEP round trip changed validity or solid count')
        metrics['stepRoundTrip'] = {'valid': True, 'solidCount': len(restored.Solids())}
        cq.exporters.export(compound, str(candidate / 'asset.stl'), tolerance=.05, angularTolerance=.1)
        meshes = []
        scene = trimesh.Scene()
        for name, shape in shapes:
            vertices, faces = shape.tessellate(.15 if mode == 'quick' else .05, .1)
            # The canonical geometry remains Z-up millimetres; GLB is Y-up metres.
            points = np.array([[v.x, v.z, -v.y] for v in vertices]) * .001
            mesh = trimesh.Trimesh(vertices=points, faces=np.asarray(faces), process=True)
            mesh.visual.vertex_colors = [135, 163, 146, 255]
            meshes.append(mesh)
            scene.add_geometry(mesh, node_name=name, geom_name=name)
        (candidate / 'asset.glb').write_bytes(scene.export(file_type='glb'))
        metrics['mesh'] = {'triangles': sum(len(m.faces) for m in meshes),
                           'watertight': all(m.is_watertight for m in meshes)}
        if not metrics['mesh']['watertight']:
            raise ValueError('Tessellated CAD output has open or non-manifold edges')
        (candidate / 'metrics.json').write_text(json.dumps(metrics, indent=2), encoding='utf-8')
        try:
            with render_slot():
                subprocess.run([blender, '-b', '--factory-startup', '--python-exit-code', '1', '--python',
                                str(root / 'render_views.py'), '--', str(candidate / 'asset.glb'), str(candidate)], check=True)
        except (subprocess.CalledProcessError, FileNotFoundError) as error:
            raise RuntimeError('CAD rendering failed; inspect the Blender runtime rather than changing the source geometry') from error
        files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in candidate.iterdir() if p.is_file()}
        manifest = {'version': 1, 'cadquery': cq.__version__, 'python': platform.python_version(), 'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
                    'specSha256': hashlib.sha256((root / 'spec.json').read_bytes()).hexdigest(), 'files': files,
                    'mode': mode, 'units': 'mm'}
        (candidate / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        # Candidate publication preserves the last successful build if execution or rendering fails.
        if destination.exists():
            previous = destination.with_name(destination.name + '-previous')
            if previous.exists(): shutil.rmtree(previous)
            destination.rename(previous)
            try: shutil.copytree(candidate, destination)
            except Exception:
                if destination.exists(): shutil.rmtree(destination)
                previous.rename(destination)
                raise
            shutil.rmtree(previous)
        else:
            shutil.copytree(candidate, destination)
    return metrics


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--blender', default='blender')
    parser.add_argument('--mode', choices=['quick', 'final'], default='final')
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent
    try:
        build(root, root / ('preview' if args.mode == 'quick' else 'output'), args.blender, args.mode)
    except Exception:
        (root / 'failure.json').write_text(json.dumps({'kind': 'cad-build', 'message': traceback.format_exc()}), encoding='utf-8')
        traceback.print_exc()
        sys.exit(1)
