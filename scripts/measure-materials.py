"""Reproduce the small CC0 calibration corpus. Powered by Poly Haven.

Network access is explicit here; generation and relocated bundles stay offline.
Run with the configured Python environment from the repository root.
"""
import hashlib
import io
import json
import pathlib
import urllib.request
import numpy as np
from PIL import Image

def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'SticksClayCalibration/1.0'}),timeout=60).read()

targets={}
for recipe,asset in [('wood','wood_floor'),('brick','brick_floor_003')]:
    info=json.loads(fetch('https://api.polyhaven.com/info/'+asset))
    files=json.loads(fetch('https://api.polyhaven.com/files/'+asset))
    record={'asset':asset,'source':'https://polyhaven.com/a/'+asset,'license':'CC0-1.0',
            'dimensionsMillimetres':info['dimensions'],'maps':{},'statistics':{}}
    for name,channel in [('Diffuse','albedo'),('Rough','roughness')]:
        entry=files[name]['1k']['png'];data=fetch(entry['url'])
        if hashlib.md5(data).hexdigest()!=entry['md5']:raise ValueError('Source checksum mismatch')
        image=Image.open(io.BytesIO(data)).convert('RGB' if channel=='albedo' else 'L')
        values=np.asarray(image,dtype=np.float64)/255
        if channel=='albedo':values=np.where(values<=.04045,values/12.92,((values+.055)/1.055)**2.4)
        record['maps'][channel]={'url':entry['url'],'sha256':hashlib.sha256(data).hexdigest(),'size':image.size}
        record['statistics'][channel]={'mean':values.mean(axis=(0,1)).tolist(),'std':values.std(axis=(0,1)).tolist()}
    targets[recipe]=record
path=pathlib.Path('blender/materials/calibration-targets.json')
path.write_text(json.dumps({'version':1,'preprocessing':'PNG 1K; sRGB albedo decoded to linear; roughness linear; population mean/std over all pixels; no crop or resize','targets':targets},indent=2)+'\n')
print('Measured',len(targets),'CC0 references:',path)
