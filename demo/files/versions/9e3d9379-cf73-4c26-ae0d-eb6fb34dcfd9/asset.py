import bpy, math, random
from mathutils import Vector
import assetkit as kit
rng=random.Random(PARAMS.get('seed',1))
# Hollowmere: silhouette blockout. Metres, front -Y.
root=kit.root('Spellbook_Stack_Root')
leather=kit.color_material('leather_burgundy_blockout',(0.22,0.045,0.055,1),roughness=.78)
leather2=kit.color_material('leather_warm_burgundy_blockout',(0.29,0.065,0.065,1),roughness=.78)
pages=kit.color_material('pages_honey_oak_blockout',(.58,.36,.15,1),roughness=.85)
page_dark=kit.color_material('page_groove_shadow_blockout',(.33,.18,.075,1),roughness=.9)
teal=kit.color_material('binding_deep_teal_blockout',(.025,.16,.16,1),roughness=.75)
brass=kit.color_material('clasp_aged_brass_blockout',(.48,.30,.09,1),roughness=.55)
wax=kit.color_material('wax_candle_cream_blockout',(.92,.76,.45,1),roughness=.83)
wickmat=kit.color_material('wick_charcoal_blockout',(.035,.021,.014,1),roughness=1)
fire=kit.color_material('flame_warm_amber_blockout',(1,.36,.035,1),roughness=.6)

def mesh(name,verts,faces,mat,parent):
    me=bpy.data.meshes.new(name+'_mesh'); me.from_pydata(verts,[],faces); me.update()
    ob=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(ob); ob.data.materials.append(mat); ob.parent=parent
    return ob

def assembly(name,parent,loc,angle=0):
    ob=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(ob); ob.parent=parent; ob.location=loc; ob.rotation_euler.z=angle
    return ob

def box(name,size,loc,rad,mat,parent):
    ob=kit.rounded_box(name,size=size,location=loc,radius=rad,material=mat)
    ob.parent=parent
    return ob

# Covers: custom clipped-corner profiles rather than untreated box silhouettes.
def cover(name,w,d,z,mat,parent):
    c=.007; profile=[(-w/2+c,-d/2),(w/2-c,-d/2),(w/2,-d/2+c),(w/2,d/2-c),(w/2-c,d/2),(-w/2+c,d/2),(-w/2,d/2-c),(-w/2,-d/2+c)]
    ob=kit.extrude(name,profile,depth=.0045,material=mat); ob.parent=parent; ob.location.z=z; kit.bevel(ob,width=.0012,segments=2)
    return ob

# Continuous curved spine section, extruded across book width.
def spine(name,w,d,h,parent,mat,x0=None,x1=None):
    if x0 is None: x0=-w/2+.003
    if x1 is None: x1=w/2-.003
    section=[]
    for j in range(9):
        a=-math.pi/2+j*math.pi/8
        section.append((-d/2+.008-.012*math.cos(a),h/2+(h/2-.002)*math.sin(a)))
    section += [(-d/2+.014,h-.002),(-d/2+.014,.002)]
    n=len(section); verts=[(x,y,z) for x in (x0,x1) for y,z in section]
    faces=[tuple(range(n-1,-1,-1)),tuple(range(n,n*2))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    ob=mesh(name,verts,faces,mat,parent); kit.bevel(ob,width=.001,segments=2); return ob

books=[]
specs=[('book_bottom',.270,.200,.041,(0,0,0),0,leather),('book_middle',.232,.170,.038,(.005,.005,.042),math.radians(-5),leather2),('book_top',.190,.140,.034,(-.004,.009,.081),math.radians(4),leather)]
for name,w,d,h,loc,angle,mat in specs:
    owner=assembly(name,root,loc,angle); books.append(owner)
    cover(name+'_cover_lower',w,d,0,mat,owner); cover(name+'_cover_upper',w,d,h-.0045,mat,owner)
    box(name+'_page_block',(w-.014,d-.021,h-.011),(0,.003,h/2),.002,pages,owner)
    spine(name+'_spine',w,d,h,owner,mat)
    # Restrained, broad teal label and two structural raised bands.
    spine(name+'_spine_teal_panel',w,d+.001,h-.002,owner,teal,-w*.22,-w*.02).location.z=.001
    for idx,x in enumerate([-w*.25,-w*.0]):
        ob=spine(name+'_spine_band_'+str(idx+1),w,d+.003,h,owner,brass,x-.002,x+.002)
    # Few page-edge grooves; blocked as narrow recessed-value strips.
    for idx,t in enumerate([.30,.54,.73]):
        z=.006+(h-.012)*t
        box(name+'_page_edge_line_'+str(idx+1),(.00045,d-.030,.00045),(w/2-.00685,.006,z),.0001,page_dark,owner)
# One clasp only, on the middle spine.
b=books[1]
box('book_middle_clasp_strap',(.014,.004,.034),(.065,-.087,.019),.0015,leather,b)
box('book_middle_clasp_brass',(.019,.005,.013),(.065,-.091,.020),.0015,brass,b)

# Candle assembly rests on upper cover, offset slightly right for asymmetry.
candle=assembly('candle_assembly',books[2],(.019,-.003,.034))
# Faceted wax base footprint with varying radial contour.
n=32
base_r=[.029*(1+.10*math.sin(i*2.4)+.06*math.cos(i*.9)) for i in range(n)]
def ring(r,z,cx=0,cy=0): return [(cx+(r[i] if isinstance(r,list) else r)*math.cos(2*math.pi*i/n),cy+(r[i] if isinstance(r,list) else r)*math.sin(2*math.pi*i/n),z[i] if isinstance(z,list) else z) for i in range(n)]
kit.loft('candle_wax_pool',[ring([r*.85 for r in base_r],.0005),ring(base_r,.0025),ring([r*.88 for r in base_r],.005)],material=wax,owner=candle)
# One continuous vessel-like wax surface with shallow dished top.
rads=[.023*(1+.025*math.sin(i*1.9)) for i in range(n)]
topz=[.055+.0015*math.sin(i*.8)+.0008*math.cos(i*1.7) for i in range(n)]
body=kit.loft('candle_wax_body',[ring([r*1.06 for r in rads],.003),ring(rads,.012),ring([r*.97 for r in rads],.043),ring(rads,topz),ring(.018,[z-.002 for z in topz]),ring(.010,.050)],material=wax,owner=candle)
# Clinging wax runs meet the rim; rounded taper without disconnected beads.
for idx,(a,length,width) in enumerate([(-2.6,.024,.004),(-1.85,.040,.0038),(-1.05,.017,.0047),(-.2,.033,.004),(1.3,.021,.0038),(2.5,.036,.0033)]):
    zs=[.054,.051,.054-length+.004,.054-length,.054-length-.001]
    rr=[width*.7,width,width*.85,width*.6,.0005]
    pts=[(.023*math.cos(a),.023*math.sin(a),z) for z in zs]
    kit.tube('candle_wax_run_'+str(idx+1),pts,radii=rr,segments=8,material=wax,owner=candle)
kit.tube('candle_dark_wick',[(0,0,.050),(.001,0,.058),(-.0005,0,.061)],radii=[.0013,.0011,.0007],segments=7,material=wickmat,owner=candle)
# Deliberately asymmetric flame loft, not a sphere.
flrings=[]
for z,r,x in [(.058,.0015,0),(.062,.005,0),(.069,.006,0),(.076,.0035,.001),(.083,.0014,.003),(.087,.0002,.002)]:
    flrings.append([(x+r*math.cos(2*math.pi*i/10),r*.65*math.sin(2*math.pi*i/10),z) for i in range(10)])
kit.loft('candle_flame',flrings,material=fire,owner=candle)
# Helper owner parenting preserves world transforms; these meshes were authored
# in candle-local space, so explicitly restore their local construction frame.
from mathutils import Matrix
for child in candle.children:
    child.matrix_parent_inverse=Matrix.Identity(4)
    child.matrix_basis=Matrix.Identity(4)
    if child.name.startswith('candle_wax_'):
        for vertex in child.data.vertices:
            vertex.co.x *= 1.30
            vertex.co.y *= 1.30
# Exercise rigid placement pivots, then restore. Parenting is intentionally shallow.
bpy.context.view_layer.update()
for ob in books+[candle]:
    origin=ob.matrix_world.translation.copy(); original=ob.rotation_euler.copy(); before={ch.name:ch.matrix_world.translation.copy() for ch in ob.children}
    ob.rotation_euler.z += .35; bpy.context.view_layer.update()
    assert (ob.matrix_world.translation-origin).length < 1e-7
    ob.rotation_euler=original; bpy.context.view_layer.update()
    assert all((ch.matrix_world.translation-before[ch.name]).length<1e-6 for ch in ob.children)
print('PLACEMENT_PIVOTS_TESTED',[(o.name,o.parent.name,list(o.location)) for o in books+[candle]])
finish_asset(material_mode='poly')
