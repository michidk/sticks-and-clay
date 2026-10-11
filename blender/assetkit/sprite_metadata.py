"""Per-cell export, bounded palette diagnostics and paged review evidence."""
import json
import os
import bpy
import numpy as np

def export_evidence(sheet, frames, cells, directory, options, size, directions, pixel, supersample, source_fps, playback_fps, zoom, padding):
    colors=np.unique(sheet[:,:,:3][sheet[:,:,3]>.5],axis=0) if pixel else np.empty((0,3))
    encoded=np.where(colors<=.0031308,colors*12.92,1.055*np.maximum(colors,0)**(1/2.4)-.055)
    effective=['#'+''.join(f'{int(round(c*255)):02x}' for c in row) for row in np.clip(encoded,0,1)]
    warnings=[]
    for row in range(len(frames)):
        for col in range(directions):
            cell=sheet[(len(frames)-1-row)*size:(len(frames)-row)*size,col*size:(col+1)*size]
            opaque=cell[:,:,3]>.5
            if np.any(opaque[0]) or np.any(opaque[-1]) or np.any(opaque[:,0]) or np.any(opaque[:,-1]):
                warnings.append(f'Direction {col}, frame {frames[row]} touches the cell boundary; increase padding or reduce zoom.')
            name=f'frame-{col}-{row:02d}.png'
            item=bpy.data.images.new(name,width=size,height=size,alpha=True,float_buffer=True)
            item.pixels.foreach_set(cell.ravel()); item.filepath_raw=os.path.join(directory,name); item.file_format='PNG'; item.save(); bpy.data.images.remove(item)
            cells[row*directions+col]['file']=name
    with open(os.path.join(directory,'sprite-checks.json'),'w',encoding='utf-8') as file:
        json.dump({'palette':effective,'colorCount':len(effective),'warnings':warnings,'hardAlpha':bool(np.all((sheet[:,:,3]==0)|(sheet[:,:,3]==1)))},file,indent=2)
    with open(os.path.join(directory,'sprites.json'),'w',encoding='utf-8') as file:
        json.dump({'version':2,'fps':playback_fps,'sourceFps':source_fps,'cells':cells,
                   'layout':'rows=frames, columns=directions','front':'direction 0, model -Y',
                   'pixel':pixel,'palette':options.get('palette'),'colors':options.get('colors',16) if pixel else None,
                   'outline':options.get('outline'),'effectivePalette':effective,'supersample':supersample,
                   'size':size,'directions':directions,'frameCount':len(frames),'loop':options.get('loop',False),'clip':options.get('clip',''),
                   'elevation':options.get('elevation',30),'zoom':zoom,'padding':padding,'anchor':options.get('anchor','ground'),
                   'lighting':'camera-relative' if pixel else 'studio-world'},file,indent=2)
    for start in range(0,len(frames),4):
        for column in range(0,directions,4):
            # PNG origin is bottom-left in Blender pixel buffers.
            page=sheet[(len(frames)-min(len(frames),start+4))*size:(len(frames)-start)*size,column*size:min(directions,column+4)*size].copy()
            for mode in ('color','silhouette','grayscale'):
                pixels=page.copy()
                if mode=='silhouette':pixels[:,:,:3]=.03
                elif mode=='grayscale':pixels[:,:,:3]=np.sum(pixels[:,:,:3]*np.array([.2126,.7152,.0722]),axis=-1,keepdims=True)
                name=f'review-{mode}-f{start}-d{column}.png'
                image=bpy.data.images.new(name,width=pixels.shape[1],height=pixels.shape[0],alpha=True,float_buffer=True)
                image.pixels.foreach_set(pixels.ravel());image.filepath_raw=os.path.join(directory,name);image.file_format='PNG';image.save();bpy.data.images.remove(image)
