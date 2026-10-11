"""Seeded supported-tree starting structure; adapt species and silhouette."""
import assetkit as kit
bark = kit.color_material('Bark',(.24,.12,.06,1),roughness=.9)
leaves = kit.color_material('Foliage',(.15,.31,.12,1),roughness=.85)
kit.tree('Tree',height=3,seed=PARAMS.get('seed',1),bark=bark,leaves=leaves)
finish_asset(material_mode='poly')
