"""Transparent multi-direction/frame contact sheet from the actual authored scene."""
import json
import math
import os
import bpy
import numpy as np
from mathutils import Vector


def sample_frames(scene):
    """Sample the imported active animation timeline, which may be rebased by glTF."""
    ranges=[]
    for obj in scene.objects:
        data=obj.animation_data
        if not data:continue
        if data.action:ranges.append(tuple(data.action.frame_range))
        ranges.extend((strip.frame_start,strip.frame_end) for track in data.nla_tracks if not track.mute for strip in track.strips)
    if not ranges:return [1]
    start,end=min(r[0] for r in ranges),max(r[1] for r in ranges)
    return sorted({round(start),round((start+end)/2),round(end)})


def render_sheet(scene,camera,center,span,directory,options):
    directions=int(options.get('directions',8))
    frames=list(options.get('frames',[scene.frame_start]))
    size=int(options.get('size',128))
    if not 1<=directions<=16 or not 1<=len(frames)<=32 or not 32<=size<=512:
        raise ValueError('Sprite sheet exceeds supported size')
    if any(not isinstance(f,int) or not scene.frame_start<=f<=scene.frame_end for f in frames):
        raise ValueError('Sprite frame outside animation range')
    floor=[o for o in scene.objects if o.get('studio_environment') and o.type=='MESH']
    for obj in floor:obj.hide_render=True
    scene.render.film_transparent=True
    scene.render.image_settings.color_mode='RGBA'
    scene.render.resolution_x=scene.render.resolution_y=size
    scene.cycles.samples=8
    camera.data.ortho_scale=span*1.8
    sheet=np.zeros((len(frames)*size,directions*size,4),dtype=np.float32)
    cells=[]
    for row,frame in enumerate(frames):
        scene.frame_set(frame)
        for col in range(directions):
            angle=col*math.tau/directions
            camera.location=center+Vector((math.sin(angle)*2,-math.cos(angle)*2,1))*span
            camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
            path=os.path.join(directory,f'sprite-{row}-{col}.png')
            scene.render.filepath=path
            bpy.ops.render.render(write_still=True)
            image=bpy.data.images.load(path)
            pixels=np.empty(size*size*4,dtype=np.float32)
            image.pixels.foreach_get(pixels)
            sheet[(len(frames)-1-row)*size:(len(frames)-row)*size,col*size:(col+1)*size]=pixels.reshape(size,size,4)
            bpy.data.images.remove(image)
            os.remove(path)
            cells.append({"frame":frame,"direction":col,"x":col*size,"y":row*size,"width":size,"height":size})
    image=bpy.data.images.new('Sprites',width=directions*size,height=len(frames)*size,alpha=True,float_buffer=True)
    image.pixels.foreach_set(sheet.ravel())
    image.filepath_raw=os.path.join(directory,'sprites.png')
    image.file_format='PNG'
    image.save()
    with open(os.path.join(directory,'sprites.json'),'w') as file:
        json.dump({"version":1,"fps":scene.render.fps/scene.render.fps_base,"cells":cells},file)
