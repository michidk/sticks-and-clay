"""Poly starting structure; save as asset.py and develop to the brief."""
import assetkit as kit
root = kit.root('Scout')
paint = kit.color_material('Sage paint', (.24,.38,.3,1))
metal = kit.color_material('Engine metal', (.16,.19,.2,1), roughness=.4, metallic=.7)
hull = kit.loft('Hull', [
    [(-.15,-1.5,.3),(-.15,-1.5,.65),(.15,-1.5,.65),(.15,-1.5,.3)],
    [(-.65,0,.2),(-.65,0,.9),(.65,0,.9),(.65,0,.2)],
    [(-.4,1.2,.3),(-.4,1.2,.65),(.4,1.2,.65),(.4,1.2,.3)],
], material=paint, owner=root)
kit.bevel(hull,.025)
for side, sign in [('L',-1),('R',1)]:
    wing=kit.extrude('Wing_'+side,[(-.5,-.8),(.5,-.5),(.65,.9),(-.35,.65)],.15,paint,root)
    wing.location=(sign*.9,.1,.35)
    engine=kit.lathe('Engine_'+side,[(.25,0),(.3,.2),(.2,.5)],material=metal,owner=root)
    engine.location=(sign*.65,1,.4)
kit.socket('socket_cargo',(0,.5,.2),hull)
finish_asset(material_mode='poly')
