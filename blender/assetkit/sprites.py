"""Transparent multi-direction/frame contact sheet from the actual authored scene."""
import math
import os
import bpy
import numpy as np
from mathutils import Vector


from .timeline import sample_frames as sample_frames


def render_sheet(scene,camera,center,span,directory,options):
    from .pixel import process
    from mathutils import Matrix
    directions=int(options.get('directions',8))
    frames=list(options.get('frames',[scene.frame_start]))
    size=int(options.get('size',128)); pixel=bool(options.get('pixel',False))
    supersample=4 if pixel else 1
    if not 1<=directions<=16 or not 1<=len(frames)<=32 or not 32<=size<=512 or size*size*directions*len(frames)>16_777_216:
        raise ValueError('Sprite sheet exceeds supported size')
    if any(not isinstance(f,(int,float)) or not math.isfinite(f) or not scene.frame_start<=f<=scene.frame_end for f in frames):
        raise ValueError('Sprite frame outside animation range')
    floor=[o for o in scene.objects if o.get('studio_environment') and o.type=='MESH']
    for obj in floor:obj.hide_render=True
    scene.render.film_transparent=True
    scene.render.image_settings.color_mode='RGBA'
    scene.render.resolution_x=scene.render.resolution_y=size*supersample
    scene.render.resolution_percentage=100
    scene.cycles.samples=8
    if pixel:scene.view_settings.view_transform='Standard'
    elevation=math.radians(float(options.get('elevation',30)))
    zoom=float(options.get('zoom',1)); padding=float(options.get('padding',.08))
    camera.data.type='ORTHO'; camera.data.ortho_scale=span*(1+2*padding)/zoom
    source_fps=scene.render.fps/scene.render.fps_base
    playback_fps=int(options.get('fps',scene.render.fps))
    lights=[(o,o.matrix_world.copy()) for o in scene.objects if o.type=='LIGHT']
    sheet=np.zeros((len(frames)*size,directions*size,4),dtype=np.float32)
    cells=[]
    from bpy_extras.object_utils import world_to_camera_view
    try:
        for row,frame in enumerate(frames):
            scene.frame_set(math.floor(frame),subframe=frame-math.floor(frame))
            for col in range(directions):
                angle=col*math.tau/directions
                if pixel:
                    transform=Matrix.Translation(center)@Matrix.Rotation(angle,4,'Z')@Matrix.Translation(-center)
                    for light,matrix in lights:light.matrix_world=transform@matrix
                camera.location=center+Vector((math.sin(angle)*math.cos(elevation),-math.cos(angle)*math.cos(elevation),math.sin(elevation)))*span*3
                camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
                bpy.context.view_layer.update()
                anchor=Vector(options.get('anchorPoint',list(center)))
                pivot=world_to_camera_view(scene,camera,anchor)
                path=os.path.join(directory,f'sprite-{row}-{col}.png')
                scene.render.filepath=path
                bpy.ops.render.render(write_still=True)
                image=bpy.data.images.load(path)
                raw_size=size*supersample
                pixels=np.empty(raw_size*raw_size*4,dtype=np.float32)
                image.pixels.foreach_get(pixels)
                pixels=pixels.reshape(raw_size,raw_size,4)
                if supersample>1:
                    # Filter premultiplied color to avoid dark fringes, then restore straight alpha.
                    pixels[:,:,:3]*=pixels[:,:,3:4]
                    pixels=pixels.reshape(size,supersample,size,supersample,4).mean(axis=(1,3))
                    pixels[:,:,:3]/=np.maximum(pixels[:,:,3:4],1e-8)
                sheet[(len(frames)-1-row)*size:(len(frames)-row)*size,col*size:(col+1)*size]=pixels
                bpy.data.images.remove(image); os.remove(path)
                cells.append({'frame':frame,'direction':col,'azimuthDegrees':col*360/directions,
                              'pivot':[pivot.x*size,(1-pivot.y)*size], 'timeSeconds':(frame-frames[0])/source_fps,
                              'durationSeconds':1/playback_fps,
                              'x':col*size,'y':row*size,'width':size,'height':size})
        if pixel:sheet=process(sheet,size,options.get('colors',16),options.get('palette'),options.get('outline'))
        image=bpy.data.images.new('Sprites',width=directions*size,height=len(frames)*size,alpha=True,float_buffer=True)
        image.pixels.foreach_set(sheet.ravel())
        image.filepath_raw=os.path.join(directory,'sprites.png'); image.file_format='PNG'; image.save()
        bpy.data.images.remove(image)
        # A smooth render has no finite palette contract. Avoid a multi-megabyte
        # JSON list of every shaded pixel in that mode.
        from .sprite_metadata import export_evidence
        export_evidence(sheet,frames,cells,directory,options,size,directions,pixel,supersample,source_fps,playback_fps,zoom,padding)
    finally:
        for light,matrix in lights:light.matrix_world=matrix
