"""Animation timeline sampling shared by authored and imported sprites."""

def select_clip(scene, clip, document):
    """Resolve stable GLB animation indices through the importer's name mapping."""
    if not clip:return
    if clip.startswith('@animation:'):
        from io_scene_gltf2.blender.imp.blender_gltf import BlenderGlTF
        index=int(clip.split(':',1)[1]); names=[]; used=set()
        for i, animation in enumerate(document.get('animations',[])):
            name=BlenderGlTF.find_unused_name(used,animation.get('name') or 'Anim_%d'%i)
            names.append(name);used.add(name)
        if index<0 or index>=len(names):raise ValueError('Animation index not found')
        clip=names[index]
    matched=False
    owners=list(scene.objects)+[o.data.shape_keys for o in scene.objects if o.type=='MESH' and o.data.shape_keys]
    for obj in owners:
        data=obj.animation_data
        if not data:continue
        data.action=None
        for track in data.nla_tracks:
            active=track.name==clip or any(s.name==clip or (s.action and s.action.name==clip) for s in track.strips)
            track.mute=not active;matched=matched or active
    if not matched:raise ValueError('Animation clip not found: '+clip)
def sample_frames(scene, count=3, loop=False):
    """Sample the imported active animation timeline, which may be rebased by glTF."""
    ranges=[]
    owners=list(scene.objects)+[obj.data.shape_keys for obj in scene.objects if obj.type=='MESH' and obj.data.shape_keys]
    for obj in owners:
        data=obj.animation_data
        if not data:continue
        if data.action:ranges.append(tuple(data.action.frame_range))
        ranges.extend((strip.frame_start,strip.frame_end) for track in data.nla_tracks if not track.mute for strip in track.strips)
    if not ranges:return [1]
    start,end=min(r[0] for r in ranges),max(r[1] for r in ranges)
    if count==1:return [round(start)]
    return [float(start+(end-start)*i/(count if loop else count-1)) for i in range(count)] if end>start else [float(start)]
