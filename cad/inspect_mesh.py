"""Read-only bounds of a meter-space GLB in CAD Z-up millimetres."""
import json
import sys
import trimesh

scene = trimesh.load(sys.argv[1], force='scene')
low, high = scene.bounds * 1000
print(json.dumps({'units': 'mm', 'dimensionsMm': {'x': high[0] - low[0], 'y': high[2] - low[2], 'z': high[1] - low[1]},
                  'note': 'Measured mesh bounds; tessellation does not establish original CAD parameters.'}))
