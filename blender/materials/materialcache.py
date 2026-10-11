"""Optional, bounded content cache. Bundled outputs never depend on this cache."""
import hashlib
import json
import pathlib
import shutil
import uuid
import platform
import numpy
import PIL

def build_key(root, parameters, mode):
    digest=hashlib.sha256(json.dumps({'parameters':parameters,'mode':mode,
        'python':platform.python_version(),'numpy':numpy.__version__,'pillow':PIL.__version__},sort_keys=True).encode())
    for path in sorted(root.glob('*.py')):
        digest.update(path.name.encode());digest.update(path.read_bytes())
    for path in sorted(root.glob('calibration*.json')):
        digest.update(path.name.encode());digest.update(path.read_bytes())
    return digest.hexdigest()

def restore(cache, key, candidate):
    source=pathlib.Path(cache)/key
    try:
        receipt=json.loads((source/'build-receipt.json').read_text())
        if receipt['inputHash']!=key or receipt['status']!='done':return False
        for artifact in receipt['artifacts']:
            path=(source/artifact['path']).resolve()
            if not path.is_relative_to(source.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=artifact['sha256']:return False
        shutil.copytree(source,candidate,dirs_exist_ok=True)
        return True
    except (OSError,ValueError,KeyError):return False

def populate(cache, key, candidate, limit=32):
    root=pathlib.Path(cache);root.mkdir(parents=True,exist_ok=True)
    temporary=root/('.candidate-'+uuid.uuid4().hex)
    try:
        shutil.copytree(candidate,temporary)
        target=root/key
        # Never mutate a cache entry used by another reader. Corrupt entries
        # are ignored and can be removed by retention instead.
        if not target.exists():temporary.rename(target)
    except FileExistsError:pass
    finally:
        if temporary.exists():shutil.rmtree(temporary)
    entries=sorted((p for p in root.iterdir() if p.is_dir() and len(p.name)==64),key=lambda p:p.stat().st_mtime,reverse=True)
    for path in entries[limit:]:
        try:shutil.rmtree(path)
        except OSError:pass
