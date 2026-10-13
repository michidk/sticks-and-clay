"""Offline material runner: python render.py [--mode quick|final]."""
import argparse
import importlib.util
import json
import pathlib
import hashlib
import shutil
import sys
import traceback
import uuid
import platform
import os
import time
from materialcache import build_key, restore, populate
from materialkit import save, check
from build_artifacts import publish
from materialcalibration import calibrate

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['quick', 'final'], default='final')
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent
    params = check(json.loads((root / 'params.json').read_text(encoding='utf-8')))
    if args.mode == 'quick': params['size'] = min(params['size'], 128)
    output = root / ('preview' if args.mode == 'quick' else 'output')
    candidate=root/('.candidate-'+uuid.uuid4().hex)
    candidate.mkdir()
    (root/'failure.json').unlink(missing_ok=True)
    started=time.perf_counter()
    key=build_key(root,params,args.mode)
    cache=os.environ.get('STUDIO_MATERIAL_CACHE')
    try:
        cached=bool(cache and restore(cache,key,candidate))
        if not cached:
            try:
                spec = importlib.util.spec_from_file_location('asset', root / 'asset.py')
                asset = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(asset)
                result=asset.build(params)
                result,calibration=calibrate(result,params['recipe'],params.get('calibration',0),json.loads((root/'calibration-targets.json').read_text()))
                (candidate/'calibration.json').write_text(json.dumps(calibration,indent=2))
            except Exception:
                (root/'failure.json').write_text(json.dumps({'kind':'script','message':traceback.format_exc()}))
                traceback.print_exc(); sys.exit(1)
            try: save(result, params, candidate)
            except Exception:
                (root/'failure.json').write_text(json.dumps({'kind':'validation','message':traceback.format_exc()}))
                traceback.print_exc(); sys.exit(3)
            artifacts=[]
            for path in sorted(candidate.iterdir()):
                if not path.is_file(): continue
                item={'id':path.stem,'role':path.stem,'path':path.name,'label':path.stem,
                      'mime':'image/png' if path.suffix=='.png' else 'application/json',
                      'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
                if path.suffix=='.png':
                    from PIL import Image
                    with Image.open(path) as image: item.update(width=image.width,height=image.height)
                artifacts.append(item)
            receipt={'version':1,'buildId':uuid.uuid4().hex,'kind':'material','mode':args.mode,'status':'done',
                     'inputHash':key,'inputs':{'scriptSha256':hashlib.sha256((root/'asset.py').read_bytes()).hexdigest(),'parametersSha256':hashlib.sha256(json.dumps(params,sort_keys=True).encode()).hexdigest(),'toolkitSha256':hashlib.sha256(b''.join(path.read_bytes() for path in sorted(root.glob('material*.py')))).hexdigest()},
                     'artifacts':artifacts,'checks':[],'timings':{'executionSeconds':time.perf_counter()-started},'toolchain':{'python':platform.python_version()}}
            (candidate/'build-receipt.json').write_text(json.dumps(receipt,indent=2))
            if cache:populate(cache,key,candidate)
        publish(candidate,output)
        (root/'failure.json').unlink(missing_ok=True)
        print('Review:', output / 'review.png')
    finally:
        if candidate.exists(): shutil.rmtree(candidate)
