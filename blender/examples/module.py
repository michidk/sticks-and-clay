"""Whole-cell wall with an actual passage; assemble at declared grid interfaces."""
import assetkit as kit
root=kit.root('Passage')
stone=kit.color_material('Stone',(.45,.49,.43,1),roughness=.85)
left=kit.rounded_box('Pier_L',(.5,1,2),(-.75,0,1),radius=.015,material=stone,owner=root)
right=kit.rounded_box('Pier_R',(.5,1,2),(.75,0,1),radius=.015,material=stone,owner=root)
lintel=kit.rounded_box('Lintel',(2,1,.5),(0,0,2.25),radius=.015,material=stone,owner=root)
for part in [left,right,lintel]:
    kit.collider(part,'box')
kit.grid_piece(left,(1,2,4),cell_size=.5)
kit.grid_piece(right,(1,2,4),cell_size=.5)
kit.grid_piece(lintel,(4,2,1),cell_size=.5)
# The complete assembly spans 2 x 1 x 2.5 metres; piers leave a 1 m passage.
kit.socket('socket_join_L',(-1,0,0),root,forward=(-1,0,0))
kit.socket('socket_join_R',(1,0,0),root,forward=(1,0,0))
finish_asset(material_mode='poly')
