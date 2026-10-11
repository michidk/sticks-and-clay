"""Optional bounded response calibration; does not assert physical realism."""
import numpy as np

def measure(result):
    return {'albedoMeanLinear':result['albedo'].mean(axis=(0,1)).tolist(),
            'roughnessMean':float(result['roughness'].mean())}

def calibrate(result, recipe, strength, corpus):
    before=measure(result)
    target=corpus['targets'].get(recipe)
    report={'version':corpus['version'],'strength':strength,'before':before,'applied':False}
    if not strength or not target:
        report['reason']='disabled' if not strength else 'unsupported class'
        return result,report
    # Bounded monotonic transforms preserve feature masks and ranking. Never
    # calibrate metal pixels from dielectric examples or alter physical height.
    out=dict(result);mask=(1-result['metallic'])[...,None]
    ratio=np.clip(np.array(target['statistics']['albedo']['mean'])/np.maximum(before['albedoMeanLinear'],1e-6),.5,2)
    out['albedo']=np.clip(result['albedo']*(1+mask*strength*(ratio-1)),0,1)
    delta=np.clip(target['statistics']['roughness']['mean']-before['roughnessMean'],-.2,.2)
    out['roughness']=np.clip(result['roughness']+strength*delta*(1-result['metallic']),.05,1)
    report.update(applied=True,source=target['source'],after=measure(out))
    return out,report
