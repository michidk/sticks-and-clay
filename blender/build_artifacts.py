"""Receipt and candidate publication helpers, independent of Blender and services."""
import hashlib
import json
import pathlib
import shutil
import struct
import uuid

def atomic_json(path, value):
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        temporary.write_text(json.dumps(value,indent=2),encoding='utf-8')
        temporary.replace(path)
    finally:temporary.unlink(missing_ok=True)

def validate(directory):
    directory=pathlib.Path(directory).resolve()
    record=json.loads((directory/'build-receipt.json').read_text(encoding='utf-8'))
    if record.get('status')!='done':raise ValueError('Cannot publish an incomplete build')
    for artifact in record['artifacts']:
        path=(directory/artifact['path']).resolve()
        if not path.is_relative_to(directory) or not path.is_file():raise ValueError('Invalid artifact path')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=artifact['sha256']:raise ValueError('Artifact hash mismatch: '+artifact['path'])
    return record

def committed_directory(directory):
    directory=pathlib.Path(directory).resolve()
    pointer=directory/'output-current.json'
    if not pointer.exists():return directory
    record=json.loads(pointer.read_text(encoding='utf-8'))
    generation=(directory/record['directory']).resolve()
    if not generation.is_relative_to(directory):raise ValueError('Invalid publication directory')
    if hashlib.sha256((generation/'build-receipt.json').read_bytes()).hexdigest()!=record['receiptSha256']:
        raise ValueError('Committed build receipt changed')
    return generation

def _mirror(source, destination, names):
    for name in names:
        if pathlib.Path(name).name!=name or name in ('.','..'):raise ValueError('Invalid publication member')
        target=destination/name
        if target.is_dir():shutil.rmtree(target)
        else:target.unlink(missing_ok=True)
        origin=source/name
        if origin.is_dir():shutil.copytree(origin,target)
        elif origin.exists():shutil.copyfile(origin,target)

def recover_workspace(destination):
    """Repair legacy aliases after interruption; the pointer is the commit record."""
    destination=pathlib.Path(destination)
    journal=destination/'publication-pending.json'
    if not journal.exists():return
    pending=json.loads(journal.read_text(encoding='utf-8'))
    pointer=destination/'output-current.json'
    committed=json.loads(pointer.read_text(encoding='utf-8')) if pointer.exists() else pending['previous']
    source=(destination/committed['directory']).resolve()
    if not source.is_relative_to(destination.resolve()):raise ValueError('Invalid publication directory')
    _mirror(source,destination,pending['members'])
    journal.unlink()

def publish_workspace(candidate, destination, names):
    """Immutable generation + atomic pointer, with recoverable legacy root aliases.

    Call under the workspace lock. Readers use output-current.json; old clients
    retain their filenames. Only publication-owned members are ever replaced.
    """
    candidate,destination=pathlib.Path(candidate),pathlib.Path(destination)
    validate(candidate)
    if any(pathlib.Path(name).name!=name or name in ('.','..') for name in names):raise ValueError('Invalid publication member')
    destination.mkdir(parents=True,exist_ok=True)
    recover_workspace(destination)
    store=destination/'.published';store.mkdir(exist_ok=True)
    pointer=destination/'output-current.json'
    previous=json.loads(pointer.read_text(encoding='utf-8')) if pointer.exists() else None
    members=sorted(set(names)|set(previous.get('members',[]) if previous else []))
    if previous is None:
        backup=store/uuid.uuid4().hex;backup.mkdir()
        for name in members:
            origin=destination/name
            if origin.is_dir():shutil.copytree(origin,backup/name)
            elif origin.exists():shutil.copyfile(origin,backup/name)
        previous={'directory':backup.relative_to(destination).as_posix(),'members':members}
    generation=store/uuid.uuid4().hex
    shutil.copytree(candidate,generation)
    record={'version':1,'directory':generation.relative_to(destination).as_posix(),'members':list(names),
            'receiptSha256':hashlib.sha256((generation/'build-receipt.json').read_bytes()).hexdigest()}
    atomic_json(destination/'publication-pending.json',{'members':members,'previous':previous})
    try:
        _mirror(generation,destination,members)
        atomic_json(pointer,record)
    except BaseException:
        recover_workspace(destination)
        raise
    (destination/'publication-pending.json').unlink()
    # Keep the immediately preceding successful generation as well as current.
    keep={record['directory'],previous['directory']}
    for path in store.iterdir():
        if path.is_dir() and path.relative_to(destination).as_posix() not in keep:shutil.rmtree(path)
    return record

def receipt(directory, kind, mode, input_hash, toolchain):
    artifacts=[]
    for path in sorted(pathlib.Path(directory).iterdir()):
        if not path.is_file() or path.name in ('build-receipt.json','build-state.json','state.json','build.log'):continue
        if path.suffix not in ('.png','.json','.glb','.blend'):continue
        data=path.read_bytes()
        item={'id':path.stem,'role':path.stem,'path':path.name,'label':path.stem,
              'mime':'image/png' if path.suffix=='.png' else 'application/octet-stream',
              'sha256':hashlib.sha256(data).hexdigest()}
        if data[:8]==b'\x89PNG\r\n\x1a\n':item.update(zip(('width','height'),struct.unpack('>II',data[16:24])))
        artifacts.append(item)
    directory=pathlib.Path(directory)
    inputs={path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in directory.iterdir()
            if path.is_file() and (path.suffix=='.py' or path.name in ('params.json','source.glb','build-config.json'))}
    helpers=sorted((directory/'assetkit').glob('*.py'))
    if helpers:inputs['assetkit']=hashlib.sha256(b''.join(path.name.encode()+path.read_bytes() for path in helpers)).hexdigest()
    record={'version':1,'buildId':uuid.uuid4().hex,'kind':kind,'mode':mode,'status':'done',
            'inputHash':input_hash,'inputs':inputs,'artifacts':artifacts,'checks':[],'timings':{},'toolchain':toolchain}
    (pathlib.Path(directory)/'build-receipt.json').write_text(json.dumps(record,indent=2))
    return record

def publish(candidate, output):
    """Publish an output directory through the same recoverable generation contract."""
    candidate,output=pathlib.Path(candidate),pathlib.Path(output)
    record=publish_workspace(candidate,output,[path.name for path in candidate.iterdir()])
    shutil.rmtree(candidate)
    return record
