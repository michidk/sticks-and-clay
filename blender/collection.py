"""Deterministic collection views. Imported GLBs keep their relative scale."""
import bpy,json,sys,math,os
from mathutils import Vector
config=json.load(open(sys.argv[sys.argv.index('--')+1]))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
groups=[];asset_objects=[];cursor=0;maxheight=0
for item in config['assets']:
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=item['path'])
    objects=set(bpy.data.objects)-before
    roots=[o for o in objects if o.parent not in objects]
    asset_objects.extend(o for o in objects if o.type=="MESH")
    points=[o.matrix_world@Vector(c) for o in objects if o.type=='MESH' for c in o.bound_box]
    lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
    width=hi.x-lo.x;height=hi.z-lo.z;depth=hi.y-lo.y
    offset=Vector((cursor-lo.x,-(lo.y+hi.y)/2,-lo.z))
    for o in roots:o.location+=offset
    groups.append((roots,width,depth,height,cursor+width/2))
    cursor+=width+max(width*.5,.25);maxheight=max(maxheight,height)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1280;scene.render.resolution_y=720;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
span=max(cursor,maxheight*2);center=Vector((cursor/2,0,maxheight*.42))
bpy.ops.mesh.primitive_plane_add(size=span*200,location=(0,0,-.01))
mat=bpy.data.materials.new('Neutral studio floor');mat.use_nodes=True
shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED');shader.inputs['Base Color'].default_value=(.18,.21,.17,1);shader.inputs['Roughness'].default_value=.92;bpy.context.object.data.materials.append(mat)
scene.world.color=(.3,.3,.3)
for offset,power in [((-.5,-1,1.5),1200),((1,1,1),900),((1,-1,.8),700)]:
    bpy.ops.object.light_add(type='AREA',location=center+Vector(offset)*span);o=bpy.context.object;o.data.energy=power*span**2/4;o.data.size=span;o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=center+Vector((.15,-1.8,.9))*span);camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=span*1.1;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
def fit_camera():
    bpy.context.view_layer.update()
    inverse=camera.matrix_world.inverted()
    corners=[inverse@(o.matrix_world@Vector(c)) for o in asset_objects for c in o.bound_box]
    xmin,xmax=min(p.x for p in corners),max(p.x for p in corners)
    ymin,ymax=min(p.y for p in corners),max(p.y for p in corners)
    camera.location+=camera.rotation_euler.to_matrix()@Vector(((xmin+xmax)/2,(ymin+ymax)/2,0))
    camera.data.ortho_scale=max(xmax-xmin,(ymax-ymin)*scene.render.resolution_x/scene.render.resolution_y)*1.18
    bpy.context.view_layer.update()
fit_camera()
scene.render.filepath=os.path.join(config['output'],'lineup.png');bpy.ops.render.render(write_still=True)
# A staggered display arrangement makes the rear and depth legible together.
for i,(roots,width,depth,height,x) in enumerate(groups):
    for o in roots:o.location.y+=(i%2)*max(depth,maxheight*.5)
center.y=maxheight*.2;camera.location=center+Vector((.65,-1.5,1))*span;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=span*1.25
fit_camera()
scene.render.filepath=os.path.join(config['output'],'scene.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(config['output'],'collection.blend'))
