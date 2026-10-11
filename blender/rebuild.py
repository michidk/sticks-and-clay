"""Run with Blender: blender -b --python rebuild.py. No model/API requests."""
import json
import pathlib
import sys

directory = pathlib.Path(__file__).resolve().parent
config = json.loads((directory / 'build-config.json').read_text(encoding='utf-8'))
sys.path.insert(0, str(directory))
code = (directory / 'asset.py').read_text(encoding='utf-8')
for old, relative in config.get('relocations', {}).items():
    code = code.replace(old, str(directory / relative).replace('\\', '/'))
for old in config.get('directories',[config['directory']]):
    code = code.replace(old, str(directory).replace('\\', '/'))
scope = {'OUTPUT_DIR':str(directory), 'PREVIEW_ONLY':config.get('preview', False),
         'PARAMS':config.get('params', {}), '__name__':'__main__'}
exec(compile((directory / 'helpers.py').read_text(encoding='utf-8'), 'helpers.py', 'exec'), scope)
exec(compile(code, 'asset.py', 'exec'), scope)
