"""Fixed local evaluation, without AI calls or subjective quality verdicts."""
import argparse
import importlib.util
import json
import pathlib
import platform
import sys
import time
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
from blender.materials import materialkit

parser=argparse.ArgumentParser()
parser.add_argument('--output',type=pathlib.Path,required=True)
parser.add_argument('--baseline',type=pathlib.Path)
args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
toolkits={'current':materialkit}
if args.baseline:
    spec=importlib.util.spec_from_file_location('baseline',args.baseline)
    baseline=importlib.util.module_from_spec(spec);spec.loader.exec_module(baseline)
    toolkits['baseline']=baseline
results=[]
for name,toolkit in toolkits.items():
    for recipe in materialkit.RECIPES:
        for seed in [17,91]:
            params=toolkit.check({'recipe':recipe,'size':128,'seed':seed,'featureMm':80})
            directory=args.output/name/f'{recipe}-{seed}'
            start=time.perf_counter();result=toolkit.build_material(params)
            metadata=toolkit.save(result,params,directory)
            results.append({'toolkit':name,'version':toolkit.VERSION,'recipe':recipe,'seed':seed,
                'seconds':round(time.perf_counter()-start,4),'validation':metadata['validation']})
(args.output/'evaluation.json').write_text(json.dumps({'version':1,'python':platform.python_version(),
    'limits':'12 fixed local renders per toolkit. Statistics and seams do not establish perceptual quality. Agent feature coverage and repair cost require a separately configured provider.','results':results},indent=2))
print('Wrote',len(results),'fixed evaluations to',args.output)
