"""Per-cell export, bounded palette diagnostics, pixel-art checks, engine import descriptions and paged review evidence."""
import json
import os
import bpy
import numpy as np


def engine_metadata(cells, sheet_width, sheet_height, size, fps, loop, pixel):
    """Unity and Godot import descriptions of the sheet. Every cell shares one ground pivot (the camera orbits the
    vertical axis through the anchor), so one pivot serves all cells; each direction is one clip of its frames."""
    px, py = cells[0]['pivot']
    pivot = [round(px / size, 5), round(1 - py / size, 5)]
    directions = sorted({c['direction'] for c in cells})
    name = lambda c: f"d{c['direction']}_f{c['frame_index']:02d}"  # noqa: E731
    clips = [{'name': f'direction_{d}', 'fps': fps, 'loop': bool(loop),
              'sprites': [name(c) for c in cells if c['direction'] == d]} for d in directions]
    multi = len(cells) > 1
    unity = {
        'format': 'unity-sprite-import', 'version': 1, 'texture': 'sprites.png',
        'textureImporter': {'textureType': 'Sprite', 'spriteImportMode': 'Multiple' if multi else 'Single',
                            'spritePixelsPerUnit': 16 if size <= 16 else 32,
                            'filterMode': 'Point' if pixel else 'Bilinear', 'textureCompression': 'Uncompressed',
                            'mipmapEnabled': False, 'alphaIsTransparency': True, 'wrapMode': 'Clamp'},
        'pivot': pivot, 'pivotPx': [round(px, 2), round(py, 2)],
        'sprites': [{'name': name(c), 'rect': {'x': c['x'], 'y': sheet_height - c['y'] - c['height'], 'width': c['width'], 'height': c['height']},
                     'alignment': 'Custom', 'pivot': pivot} for c in cells],
        'clips': [clip for clip in clips if len(clip['sprites']) > 1],
    }
    godot = {
        'format': 'godot-sprite-frames', 'version': 1, 'texture': 'sprites.png',
        'textureFilter': 'nearest' if pixel else 'linear', 'centered': True,
        'offset': [round(size / 2 - px, 2), round(size / 2 - py, 2)],
        'animations': [{'name': f'direction_{d}', 'speed': fps, 'loop': bool(loop),
                        'frames': [{'name': name(c), 'region': [c['x'], c['y'], c['width'], c['height']], 'duration': 1}
                                   for c in cells if c['direction'] == d]} for d in directions],
    }
    return unity, godot


def export_evidence(sheet, frames, cells, directory, options, size, directions, pixel, supersample, source_fps, playback_fps, zoom, padding):
    from .pixel import cell_checks
    colors=np.unique(sheet[:,:,:3][sheet[:,:,3]>.5],axis=0) if pixel else np.empty((0,3))
    encoded=np.where(colors<=.0031308,colors*12.92,1.055*np.maximum(colors,0)**(1/2.4)-.055)
    effective=['#'+''.join(f'{int(round(c*255)):02x}' for c in row) for row in np.clip(encoded,0,1)]
    warnings=[]
    checks=[]
    for row in range(len(frames)):
        for col in range(directions):
            cell=sheet[(len(frames)-1-row)*size:(len(frames)-row)*size,col*size:(col+1)*size]
            opaque=cell[:,:,3]>.5
            if np.any(opaque[0]) or np.any(opaque[-1]) or np.any(opaque[:,0]) or np.any(opaque[:,-1]):
                warnings.append(f'Direction {col}, frame {frames[row]} touches the cell boundary; increase padding or reduce zoom.')
            if pixel:
                # The same value-range and pixel-size checks the drawn pixel art gets, per cell (top row first).
                measured,found=cell_checks(cell[::-1])
                checks.append({'direction':col,'frame':frames[row],**measured})
                warnings.extend(f'Direction {col}, frame {frames[row]}: {w}' for w in found)
            name=f'frame-{col}-{row:02d}.png'
            item=bpy.data.images.new(name,width=size,height=size,alpha=True,float_buffer=True)
            item.pixels.foreach_set(cell.ravel()); item.filepath_raw=os.path.join(directory,name); item.file_format='PNG'; item.save(); bpy.data.images.remove(item)
            cells[row*directions+col]['file']=name
            cells[row*directions+col]['frame_index']=row
    # Baseline per direction: the lowest opaque row over all its frames, against the shared ground pivot row.
    baselines=[]
    if pixel and checks:
        ground=cells[0]['pivot'][1]
        for col in range(directions):
            feet=[c['feetRow'] for c in checks if c['direction']==col and 'feetRow' in c]
            if feet: baselines.append({'direction':col,'baselinePx':max(feet),'groundPx':round(ground,2),'gapPx':round(ground-1-max(feet),2)})
    unity,godot=engine_metadata(cells,directions*size,len(frames)*size,size,playback_fps,options.get('loop',False),pixel)
    for name,doc in (('sprites.unity.json',unity),('sprites.godot.json',godot)):
        with open(os.path.join(directory,name),'w',encoding='utf-8') as file: json.dump(doc,file,indent=2)
    with open(os.path.join(directory,'sprite-checks.json'),'w',encoding='utf-8') as file:
        json.dump({'palette':effective,'colorCount':len(effective),'warnings':warnings,'hardAlpha':bool(np.all((sheet[:,:,3]==0)|(sheet[:,:,3]==1))),
                   'cells':checks,'baselines':baselines},file,indent=2)
    for cell in cells: cell.pop('frame_index',None)
    with open(os.path.join(directory,'sprites.json'),'w',encoding='utf-8') as file:
        json.dump({'version':3,'fps':playback_fps,'sourceFps':source_fps,'cells':cells,
                   'layout':'rows=frames, columns=directions','front':'direction 0, model -Y',
                   'pixel':pixel,'palette':options.get('palette'),'colors':options.get('colors',16) if pixel else None,
                   'outline':options.get('outline'),'effectivePalette':effective,'supersample':supersample,
                   'size':size,'directions':directions,'frameCount':len(frames),'loop':options.get('loop',False),'clip':options.get('clip',''),
                   'elevation':options.get('elevation',30),'zoom':zoom,'padding':padding,'anchor':options.get('anchor','ground'),
                   'lighting':'camera-relative' if pixel else 'studio-world',
                   # One ground pivot for every cell, and the integer row it stands on, for engines that snap pivots.
                   'pivot':cells[0]['pivot'],'baselinePx':int(np.floor(cells[0]['pivot'][1])),
                   'engines':{'unity':'sprites.unity.json','godot':'sprites.godot.json'}},file,indent=2)
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
