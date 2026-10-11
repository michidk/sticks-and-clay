"""Run with Blender: blender -b --python rebuild.py. No model/API requests."""
import json
import pathlib
import sys
import argparse
import re
import random

directory = pathlib.Path(__file__).resolve().parent
config = json.loads((directory / 'build-config.json').read_text(encoding='utf-8'))
parser = argparse.ArgumentParser()
parser.add_argument('--mode', choices=['quick', 'final'])
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
sys.path.insert(0, str(directory))
code = (directory / 'asset.py').read_text(encoding='utf-8')
relocations = {old: (directory / relative).as_posix() for old, relative in config.get('relocations', {}).items()}
relocations.update({old: directory.as_posix() for old in config.get('directories', [config.get('directory', '')]) if old})
# Replace once: an input rebased into a candidate must not be rebased again
# when that candidate sits beneath the original workspace directory.
if relocations:
    pattern = '|'.join(re.escape(old) for old in sorted(relocations, key=len, reverse=True))
    code = re.sub(pattern, lambda match: relocations[match.group()], code)
params_path = directory / 'params.json'
params = json.loads(params_path.read_text(encoding='utf-8')) if params_path.exists() else config.get('params', {})
seed = params.get('seed', 1)
random.seed(seed)
# Blender ships NumPy; seed it as well for scripts that author array geometry.
import numpy as np
np.random.seed(int(seed) % (2**32))
scope = {'OUTPUT_DIR':str(directory), 'PREVIEW_ONLY':args.mode == 'quick' if args.mode else config.get('preview', False),
         'PARAMS':params, '__name__':'__main__'}
exec(compile((directory / 'helpers.py').read_text(encoding='utf-8'), 'helpers.py', 'exec'), scope)
exec(compile(code, 'asset.py', 'exec'), scope)
