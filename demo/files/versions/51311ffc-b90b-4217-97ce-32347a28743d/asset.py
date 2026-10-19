import bpy, math, random
from mathutils import Vector, Matrix
import assetkit as kit
rng=random.Random(PARAMS.get('seed',1))
# Refinement retains the archived scene, assembly identities and placement frames.
bpy.ops.wm.open_mainfile(filepath='/home/vibepod/workspaces/sticks-and-clay/data/versions/9e3d9379-cf73-4c26-ae0d-eb6fb34dcfd9/source.blend')
for o in list(bpy.data.objects):
    if o.type in {'CAMERA','LIGHT'} or o.name.startswith('Studio') or o.name.startswith('studio_'):
        bpy.data.objects.remove(o,do_unlink=True)
root=bpy.data.objects['Spellbook_Stack_Root']
original_names={o.name for o in root.children_recursive}
leather=bpy.data.materials['leather_burgundy_blockout']; brass=bpy.data.materials['clasp_aged_brass_blockout']; wax=bpy.data.materials['wax_candle_cream_blockout']; pages=bpy.data.materials['pages_honey_oak_blockout']
# Vertices supplied in assembly coordinates. Existing object origins remain untouched.
def surface(name,verts,faces,mat,parent):
    ob=bpy.data.objects.get(name)
    if ob is None:
        ob=bpy.data.objects.new(name,bpy.data.meshes.new(name+'_refined_mesh')); bpy.context.collection.objects.link(ob); ob.parent=parent
    inv=ob.matrix_basis.inverted()
    me=bpy.data.meshes.new(name+'_refined_mesh'); me.from_pydata([inv@Vector(v) for v in verts],[],faces); me.update()
    ob.data=me; ob.modifiers.clear(); me.materials.append(mat)
    return ob

def loft(name,rings,mat,parent,cap=True):
    n=len(rings[0]); verts=[v for ring in rings for v in ring]; faces=[]
    for j in range(len(rings)-1):
        faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for i in range(n)]
    if cap: faces += [tuple(range(n-1,-1,-1)),tuple((len(rings)-1)*n+i for i in range(n))]
    return surface(name,verts,faces,mat,parent)

# Three stepped book envelopes are preserved (27x20, 23.2x17, 19x14 cm).
# Recessed, gently uneven page signatures continue around all exposed edges.
for name,w,d,h in [('book_bottom',.270,.200,.041),('book_middle',.232,.170,.038),('book_top',.190,.140,.034)]:
    owner=bpy.data.objects[name]
    def rect(z,inset):
        x=w/2-.007-inset; ya=-d/2+.0135+inset; yb=d/2-.0075-inset; c=.0015
        pts=[(-x+c,ya),(x-c,ya),(x,ya+c),(x,yb-c),(x-c,yb),(-x+c,yb),(-x,yb-c),(-x,ya+c)]
        return [(xx,yy,z+.00017*math.sin(xx*92+yy*64)) for xx,yy in pts]
    levels=[(.0055,.0005),(.0062,0)]
    grooves=[.006+(h-.012)*t for t in [.30,.54,.73]]
    for z in grooves: levels += [(z-.00055,0),(z-.00012,.0007),(z+.00012,.0007),(z+.00055,0)]
    levels += [(h-.0062,0),(h-.0055,.0005)]
    loft(name+'_page_block',[rect(z,s) for z,s in levels],pages,owner)
    for i,z in enumerate(grooves):
        ob=bpy.data.objects[name+'_page_edge_line_'+str(i+1)]
        loft(ob.name,[rect(z-.00009,.00069),rect(z+.00009,.00069)],ob.data.materials[0],owner,False)
    # A discreet impressed border, continuous with the leather cover rather than metal ornament.
    # Existing clipped covers and curved spine/band profiles remain unchanged.

candle=bpy.data.objects['candle_assembly']; n=64
angles=[2*math.pi*i/n for i in range(n)]
def ring(r,z):
    return [((r[i] if isinstance(r,list) else r)*math.cos(a),(r[i] if isinstance(r,list) else r)*math.sin(a),z[i] if isinstance(z,list) else z) for i,a in enumerate(angles)]
# Smooth asymmetric lobes replace the saw-toothed radial pool.
pool=[.0355*(1+.075*math.sin(3*a+.5)+.055*math.cos(5*a-.7)+.045*math.sin(a)) for a in angles]
loft('candle_wax_pool',[ring([r*.86 for r in pool],.00015),ring([r*.98 for r in pool],.0008),ring(pool,.0020),ring([r*.97 for r in pool],.0035),ring([r*.85 for r in pool],.0050),ring(.026,.0055)],wax,candle)
rad=[.0299*(1+.016*math.sin(5*a+.5)+.012*math.cos(3*a)) for a in angles]
top=[.0545+.0015*math.sin(3*a)+.0008*math.cos(5*a+.4) for a in angles]
loft('candle_wax_body',[ring([r*1.055 for r in rad],.003),ring(rad,.010),ring([r*.976 for r in rad],.034),ring(rad,[z-.003 for z in top]),ring([r*1.015 for r in rad],[z-.001 for z in top]),ring([r*.97 for r in rad],top),ring([r*.86 for r in rad],[z-.0007 for z in top]),ring(.021,.0505),ring(.012,.0485),ring(.003,.0480)],wax,candle)
# Curving wax ribbons have broad shoulders seated into the rolled lip and rounded tapering ends.
for i,(a,length,width) in enumerate([(-2.6,.024,.0052),(-1.85,.044,.0048),(-1.05,.019,.0060),(-.2,.034,.0050),(1.3,.023,.0048),(2.5,.038,.0043)]):
    ztop=.0545+.0015*math.sin(3*a)+.0008*math.cos(5*a+.4)
    rr=[]
    for t,ww,depth in [(0,.92,.0009),(.08,1.12,.0020),(.22,.80,.0022),(.62,.64,.0023),(.83,.83,.0030),(.94,.61,.0024),(1,.08,.0003)]:
        z=ztop-.001-length*t; ang=a+.035*math.sin(t*math.pi)
        # Elliptical cross sections lie half embedded in the candle shell.
        r=.0291
        rr.append([((r+depth*math.cos(2*math.pi*j/12))*math.cos(ang)-width*ww*math.sin(2*math.pi*j/12)*math.sin(ang),(r+depth*math.cos(2*math.pi*j/12))*math.sin(ang)+width*ww*math.sin(2*math.pi*j/12)*math.cos(ang),z) for j in range(12)])
    loft('candle_wax_run_'+str(i+1),rr[::-1],wax,candle)
# Refine the one existing clasp: a bent leather return wraps onto the top cover.
b=bpy.data.objects['book_middle']
section=[(-.068,.0389),(-.083,.0389),(-.088,.036),(-.092,.029),(-.092,.010),(-.090,.004),(-.087,.004),(-.089,.011),(-.089,.028),(-.085,.034),(-.082,.0364),(-.068,.0364)]
verts=[(x,y,z) for x in [.058,.072] for y,z in section]; nn=len(section)
faces=[tuple(range(nn-1,-1,-1)),tuple(range(nn,2*nn))]+[(i,(i+1)%nn,(i+1)%nn+nn,i+nn) for i in range(nn)]
strap=surface('book_middle_clasp_strap',verts,faces,leather,b); kit.bevel(strap,width=.00065,segments=2)
# Shaped brass escutcheon with clipped corners and shallow inset catch.
prof=[(-.008,-.006),(.006,-.006),(.009,-.003),(.009,.004),(.006,.006),(-.008,.006),(-.009,.004),(-.009,-.004)]
rings=[[(.065+x,-.0945+y,.021+z) for x,z in prof] for y in [0,.0027]]
clasp=loft('book_middle_clasp_brass',rings,brass,b); kit.bevel(clasp,width=.00065,segments=2)
# Raised folded catch, not an extra clasp; all parts follow the middle book.
ob=surface('book_middle_clasp_catch',[(.061,-.095,.019),(.065,-.096,.0175),(.069,-.095,.019),(.069,-.095,.023),(.065,-.097,.025),(.061,-.095,.023)],[(0,1,2,3,4,5)],brass,b)
sol=ob.modifiers.new('catch_thickness','SOLIDIFY'); sol.thickness=.0007
kit.bevel(ob,width=.0003,segments=1)
# Source hierarchy and restored placement motion checks.
bpy.context.view_layer.update()
books=[bpy.data.objects[n] for n in ['book_bottom','book_middle','book_top']]
for ob in books+[candle]:
    initial=ob.matrix_basis.copy(); positions={ch.name:ch.matrix_world.copy() for ch in ob.children_recursive}
    ob.rotation_euler.z+=.4; ob.location.x+=.012; bpy.context.view_layer.update()
    assert any((ch.matrix_world.translation-positions[ch.name].translation).length>.005 for ch in ob.children_recursive)
    ob.matrix_basis=initial; bpy.context.view_layer.update()
    assert all((ch.matrix_world.translation-positions[ch.name].translation).length<1e-6 for ch in ob.children_recursive)
assert original_names.issubset({o.name for o in root.children_recursive})
# Close thin groove strips; their hidden caps lie inside the solid page block.
for ob in root.children_recursive:
    if ob.type=='MESH' and '_page_edge_line_' in ob.name:
        me=ob.data; verts=[tuple(v.co) for v in me.vertices]; faces=[tuple(p.vertices) for p in me.polygons]
        faces += [tuple(range(7,-1,-1)),tuple(range(8,16))]
        new=bpy.data.meshes.new(ob.name+'_closed_mesh'); new.from_pydata(verts,[],faces); new.update()
        for mat in me.materials: new.materials.append(mat)
        ob.data=new
catch=bpy.data.objects['book_middle_clasp_catch']
bpy.context.view_layer.objects.active=catch
for modifier in list(catch.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
print('REFINEMENT: preserved all original named parts and local placement pivots; four rigid assembly rotation/translation tests passed.')
finish_asset(material_mode='poly')