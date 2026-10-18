"""Fixed runner: python render.py [--mode quick|final] [--blender PATH]."""
import argparse
import os
import pathlib
import runpy
import sys
import shutil
import json
import hashlib
import uuid


def main():
    directory = pathlib.Path(__file__).resolve().parent
    sys.path.insert(0, str(directory))
    try:
        import bpy
    except ImportError:
        bpy = None
    parser = argparse.ArgumentParser(description=__doc__)
    default_mode = ('quick' if json.loads((directory/'build-config.json').read_text(encoding='utf-8')).get('preview', False) else 'final') if bpy else 'quick'
    parser.add_argument('--mode', choices=['quick', 'final'], default=default_mode)
    parser.add_argument('--blender', default=os.environ.get('BLENDER_BIN', bpy.app.binary_path if bpy else 'blender'))
    parser.add_argument('--timeout', type=int, default=600)
    args = parser.parse_args((sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []) if bpy else None)
    if args.timeout < 1: parser.error('Timeout must be positive')
    from build_runtime import launch
    from build_artifacts import receipt, publish_workspace, recover_workspace
    output=directory/'preview' if args.mode=='quick' and (not bpy or globals().get('STUDIO_DIRECT_REBUILD')) else directory
    recover_workspace(output)
    candidate=directory/('.candidate-'+uuid.uuid4().hex)
    shutil.copytree(directory,candidate,ignore=shutil.ignore_patterns('.candidate-*','.published','preview','output.last','__pycache__','*.zip','output-current.json','publication-pending.json'))
    try:
        for pattern in ('front.png','rear.png','detail.png','metrics.json','asset.glb','source.blend','sprites.png','sprites.json','sprite-checks.json','sprites.unity.json','sprites.godot.json','frame-*.png','review-*-f*-d*.png','asset-lod-*.glb','lods.json','build-receipt.json','state.json'):
            for path in candidate.glob(pattern):path.unlink()
        if bpy:
            runpy.run_path(str(candidate / 'rebuild.py'), run_name='__main__', init_globals={'STUDIO_CANDIDATE': True})
            code=0
        else:
            code=launch([args.blender, '-b', '--factory-startup', '--threads', '2', '--python-exit-code', '1', '--python', str(candidate / 'render.py'), '--', '--mode', args.mode], str(candidate), args.timeout)
        if code:raise SystemExit(code)
        names=['front.png','rear.png','detail.png','metrics.json']+(['asset.glb','source.blend'] if args.mode=='final' else [])
        if any(not (candidate/name).exists() for name in names):raise RuntimeError('Build omitted required artifacts')
        for pattern in ('sprites.png','sprites.json','sprite-checks.json','sprites.unity.json','sprites.godot.json','frame-*.png','review-*-f*-d*.png','asset-lod-*.glb','lods.json'):
            names.extend(path.name for path in candidate.glob(pattern))
        if args.mode=='final' and (candidate/'textures').exists():names.append('textures')
        digest=hashlib.sha256((candidate/'asset.py').read_bytes()).hexdigest()
        receipt(candidate,'model',args.mode,digest,{'runner':'4'})
        (candidate/'state.json').write_text(json.dumps({'ok':True,'preview':args.mode=='quick','scriptSha256':digest}))
        publish_workspace(candidate,output,sorted(set(names+['state.json','build-receipt.json'])))
    finally:shutil.rmtree(candidate)


if __name__ == '__main__': main()
