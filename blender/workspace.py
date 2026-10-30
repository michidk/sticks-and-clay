"""Persistent, scoped script authoring; parameters/support are fixed for the workspace."""
import hashlib
import json
import shutil
import uuid


def atomic_write(path, content):
    temporary = path.with_name(path.name + '.' + str(uuid.uuid4()) + '.tmp')
    try:
        temporary.write_bytes(content.encode('utf-8'))
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def data_path(data, key):
    path = (data / key).resolve()
    if not path.is_relative_to(data):
        raise ValueError('Invalid workspace dependency')
    return path


def prepare(root, data, dest, info):
    dest.mkdir(parents=True, exist_ok=True)
    if (dest / 'params.json').exists():
        shutil.copyfile(root / 'blender/helpers.py', dest / 'build-support/helpers.py')
        shutil.copyfile(root / 'blender/helpers.py', dest / 'helpers.py')
        return
    source = data_path(data, info['sourceScript']) if info.get('sourceScript') else None
    if source and (not source.is_relative_to(data / 'versions') or source.name != 'asset.py'):
        raise ValueError('Expected an immutable archived source script')
    source_dir = source.parent if source else None
    config = json.loads((source_dir / 'build-config.json').read_text()) if source_dir and (source_dir / 'build-config.json').exists() else {}
    params = json.loads((source_dir / 'params.json').read_text()) if source_dir and (source_dir / 'params.json').exists() else config.get('params', {'seed': info.get('seed', 1)})
    if info.get('spriteTarget'): params={**params,'spriteTarget':info['spriteTarget']}
    dependencies = []
    if source:
        code = source.read_text(encoding='utf-8')
        for old, relative in config.get('relocations', {}).items():
            path = (source_dir / relative).resolve()
            if not path.is_relative_to(source_dir):
                raise ValueError('Invalid archived source dependency')
            dependencies.append(path.relative_to(data).as_posix())
            code = code.replace(old, path.as_posix())
        for old in config.get('directories', [config.get('directory', '')]):
            if old: code = code.replace(old, dest.as_posix())
        if not (dest / 'asset.py').exists():
            save_script(dest, code)
        if (source_dir / 'textures').exists() and not (dest / 'textures').exists():
            shutil.copytree(source_dir / 'textures', dest / 'textures')
    snapshot = dest / 'build-support'
    if not snapshot.exists():
        temporary = dest / ('support-' + str(uuid.uuid4()))
        temporary.mkdir()
        support = source_dir if source_dir and all((source_dir / n).exists() for n in ['assetkit', 'helpers.py']) else root / 'blender'
        shutil.copytree(support / 'assetkit', temporary / 'assetkit', ignore=shutil.ignore_patterns('__pycache__'))
        shutil.copyfile(support / 'helpers.py', temporary / 'helpers.py')
        # Runner protocol is shared by old and new helper bundles.
        for name in ['rebuild.py', 'render.py', 'build_runtime.py', 'build_artifacts.py']:
            shutil.copyfile(root / 'blender' / name, temporary / name)
        temporary.rename(snapshot)
    # Upgrade the runner protocol while preserving pinned geometry helpers.
    for name in ['helpers.py', 'rebuild.py', 'render.py', 'build_runtime.py', 'build_artifacts.py']:
        shutil.copyfile(root / 'blender' / name, snapshot / name)
    atomic_write(dest / 'work-source.json', json.dumps({'runnerProtocol':4,'dependencies': sorted(set(dependencies))}))
    for name in ['helpers.py', 'rebuild.py', 'render.py', 'build_runtime.py', 'build_artifacts.py']:
        if not (dest / name).exists(): shutil.copyfile(snapshot / name, dest / name)
    if not (dest / 'assetkit').exists(): shutil.copytree(snapshot / 'assetkit', dest / 'assetkit')
    if not (dest / 'build-config.json').exists():
        atomic_write(dest / 'build-config.json', json.dumps({'version': 1, 'directory': dest.as_posix(), 'preview': True, 'params': params, 'relocations': {}}))
    # Written last: a failed initialization can safely be retried.
    atomic_write(dest / 'params.json', json.dumps(params, indent=2))


def save_script(dest, code):
    code = code.replace('\r\n', '\n').replace('\r', '\n')
    digest = hashlib.sha256(code.encode('utf-8')).hexdigest()
    path = dest / 'asset.py'
    if path.exists() and path.read_text(encoding='utf-8') == code:
        return digest
    revisions = dest / 'script-revisions'
    revisions.mkdir(exist_ok=True)
    if not (revisions / (digest + '.py')).exists():
        atomic_write(revisions / (digest + '.py'), code)
    atomic_write(path, code)
    atomic_write(dest / 'build-state.json', json.dumps({'ok': False, 'state': 'edited', 'scriptSha256': digest}))
    return digest
