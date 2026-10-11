"""Receipt and candidate publication helpers, independent of Blender and services."""
import hashlib
import json
import pathlib
import shutil
import struct
import uuid

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
    record={'version':1,'buildId':uuid.uuid4().hex,'kind':kind,'mode':mode,'status':'done',
            'inputHash':input_hash,'artifacts':artifacts,'checks':[],'timings':{},'toolchain':toolchain}
    (pathlib.Path(directory)/'build-receipt.json').write_text(json.dumps(record,indent=2))
    return record

def publish(candidate, output):
    """Retain last good directory; commit pointer only after the new set exists."""
    candidate,output=pathlib.Path(candidate),pathlib.Path(output)
    last=output.with_name(output.name+'.last')
    if last.exists():shutil.rmtree(last)
    if output.exists():output.rename(last)
    try:candidate.rename(output)
    except BaseException:
        if last.exists():last.rename(output)
        raise
    pointer=output.parent/(output.name+'-current.json')
    temporary=pointer.with_suffix('.tmp')
    temporary.write_text(json.dumps({'directory':output.name,'receiptSha256':hashlib.sha256((output/'build-receipt.json').read_bytes()).hexdigest()}))
    temporary.replace(pointer)
