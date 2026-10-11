"""Offline launcher. python render.py [--blender PATH]. No AI or service needed."""
import argparse
import os
import pathlib
from build_runtime import launch

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--blender',default=os.environ.get('BLENDER_BIN','blender'))
    args=parser.parse_args(); root=pathlib.Path(__file__).resolve().parent
    raise SystemExit(launch([args.blender,'-b','--factory-startup','--threads','2','--python-exit-code','1',
                    '--python',str(root/'sprite_render.py')],str(root),900))
